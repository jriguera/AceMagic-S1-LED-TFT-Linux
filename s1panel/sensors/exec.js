'use strict';
/*!
 * s1panel - sensor/exec
 * Copyright (c) 2025 Jose Riguera
 * GPL-3 Licensed
 */
const { exec } = require('child_process');

const logger = require('../logger');

// Default configuration values
const DEFAULTS = {
    separator: ';',
    timeout: 5000,
    csv: false,
    lines: 100   // 0 means all lines (only used when csv=false)
};

var _fault = false;

function parse_csv_line(line, separator) {
    const _result = [];
    let _current = '';
    let _in_quotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const _char = line[i];
        if (_char === '"') {
            _in_quotes = !_in_quotes;
        } else if (_char === separator && !_in_quotes) {
            _result.push(_current.trim());
            _current = '';
        } else {
            _current += _char;
        }
    }
    _result.push(_current.trim());
    return _result;
}


function parse_csv_output(output, separator) {
    const _lines = output.trim().split('\n').filter(line => line.trim() !== '');
    if (_lines.length < 1) {
        return { headers: [], rows: [], row_count: 0 };
    }
    // First line is the header
    const _headers = parse_csv_line(_lines[0], separator);
    // Parse all data lines (skip header)
    const _rows = [];
    for (let r = 1; r < _lines.length; r++) {
        const _values = parse_csv_line(_lines[r], separator);
        const _row_data = {};
        for (let i = 0; i < _headers.length; i++) {
            const _header = _headers[i];
            const _value = i < _values.length ? _values[i] : '';
            _row_data[_header] = _value;
        }
        _rows.push(_row_data);
    }
    return { headers: _headers, rows: _rows, row_count: _rows.length };
}


function parse_raw_output(output, max_lines) {
    const _lines = output.trim().split('\n').filter(line => line.trim() !== '');
    // Get last N lines if max_lines is specified
    const _result_lines = max_lines > 0 ? _lines.slice(-max_lines) : _lines;
    return { lines: _result_lines, line_count: _result_lines.length };
}


function execute_command(command, timeout) {
    return new Promise(fulfill => {
        const _options = {
            timeout: timeout,
            maxBuffer: 1024 * 1024,  // 1MB buffer
            encoding: 'utf8'
        };
        exec(command, _options, (error, stdout, stderr) => {
            if (error) {
                if (!_fault) {
                    logger.error(error.message + ' (exit ' + (error.code || 'unknown') + '): ' + stderr.trim());
                    _fault = true;
                }
                // Capture return code from error object (error.code holds the exit code)
                const _exit_code = error.code !== undefined ? error.code : -1;
                fulfill({ success: false, exit_code: _exit_code, stdout: stdout || '', stderr: stderr || error.message });
                return;
            }
            _fault = false;
            fulfill({ success: true, exit_code: 0, stdout: stdout, stderr: stderr });
        });
    });
}


function sample(rate, format, config) {
    return new Promise(fulfill => {
        const _private = config._private;
        const _diff = Math.floor(Number(process.hrtime.bigint()) / 1000000) - _private.last_sampled;
        var _dirty = false;
        var _promise = Promise.resolve();

        if (!_private.last_sampled || _diff > rate) {
            _private.last_sampled = Math.floor(Number(process.hrtime.bigint()) / 1000000);
            _promise = execute_command(_private.command, _private.timeout);
            _dirty = true;
        }
        _promise.then(result => {
            if (_dirty && result) {
                _private.exit_code = result.exit_code;
                if (result.success) {
                    if (_private.csv) {
                        const _parsed = parse_csv_output(result.stdout, _private.separator);
                        _private.headers = _parsed.headers;
                        _private.rows = _parsed.rows;
                        _private.row_count = _parsed.row_count;
                    } else {
                        const _parsed = parse_raw_output(result.stdout, _private.lines);
                        _private.raw_lines = _parsed.lines;
                        _private.line_count = _parsed.line_count;
                    }
                    _private.last_success = true;
                } else {
                    _private.last_success = false;
                }
            }
            let _output;
            if (_private.csv) {
                // CSV mode
                const _headers = _private.headers || [];
                const _rows = _private.rows || [];
                const _row_count = _private.row_count || 0;
                _output = format.replace(/{([\w.]+)}/g, function (match, key) {
                    // Format codes (CSV mode):
                    // {success} - Whether the last execution was successful (true/false)
                    // {exit_code} - Return code of the last command execution
                    // {columns} - Number of fields/columns
                    // {rows} - Number of data rows
                    // {headers} - Comma-separated list of header names
                    // {json} - JSON array of all rows data
                    // 
                    // Row access:
                    // {N} - Row N as array joined by separator (N is 0-indexed)
                    // {N.column_name} - Value at row N by column name
                    switch (key) {
                        case 'success':
                            return _private.last_success ? 'true' : 'false';
                        case 'exit_code':
                            return _private.exit_code !== undefined ? _private.exit_code : -1;
                        case 'columns':
                            return _headers.length;
                        case 'rows':
                            return _row_count;
                        case 'headers':
                            return _headers.join(',');
                        case 'json':
                            return JSON.stringify(_rows);
                        default:
                            if (key.includes('.')) {
                                // Check for row.column format (e.g., {0.hostname}, {2.value})
                                const _parts = key.split('.');
                                const _row_idx = parseInt(_parts[0]);
                                const _col_key = _parts.slice(1).join('.');
                                if (!isNaN(_row_idx) && _row_idx >= 0 && _row_idx < _row_count) {
                                    const _row = _rows[_row_idx];
                                    if (_row[_col_key] !== undefined) {
                                        return _row[_col_key];
                                    }
                                }
                            } else {
                                // Check if it's a row index - return row as array joined by separator
                                const _row_idx = parseInt(key);
                                if (!isNaN(_row_idx) && _row_idx >= 0 && _row_idx < _row_count) {
                                    const _row = _rows[_row_idx];
                                    return _headers.map(h => _row[h] !== undefined ? _row[h] : '').join(_private.separator);
                                }
                            }
                            return '';
                    }
                });
            } else {
                // Raw mode (csv=false)
                const _raw_lines = _private.raw_lines || [];
                const _line_count = _private.line_count || 0;
                _output = format.replace(/{(\w+)}/g, function (match, key) {
                    // Format codes (raw mode):
                    // {success} - Whether the last execution was successful (true/false)
                    // {exit_code} - Return code of the last command execution
                    // {lines} - Number of lines
                    // {all} - All lines joined by newline
                    // {json} - JSON array of all lines
                    // {N} - Line N (0-indexed)
                    switch (key) {
                        case 'success':
                            return _private.last_success ? 'true' : 'false';
                        case 'exit_code':
                            return _private.exit_code !== undefined ? _private.exit_code : -1;
                        case 'lines':
                            return _line_count;
                        case 'all':
                            return _raw_lines.join('\n');
                        case 'json':
                            return JSON.stringify(_raw_lines);
                        default:
                            // Check if it's a line index
                            const _line_idx = parseInt(key);
                            if (!isNaN(_line_idx) && _line_idx >= 0 && _line_idx < _line_count) {
                                return _raw_lines[_line_idx];
                            }
                            return '';
                    }
                });
            }
            fulfill({ value: _output, min: 0, max: _private.csv ? (_private.headers || []).length : (_private.line_count || 0) });
        });
    });
}

function init(config) {
    if (!config?.name) {
        logger.error('exec: name is required');
        return null;
    }
    if (!config?.command) {
        logger.error('exec: command is required');
        return null;
    }
    const _name = config.name;
    const _command = config.command;
    const _separator = config?.separator ?? DEFAULTS.separator;
    const _timeout = config?.timeout ?? DEFAULTS.timeout;
    const _csv = config?.csv ?? DEFAULTS.csv;
    const _lines = config?.lines ?? DEFAULTS.lines;
    const _private = {
        name: _name,
        command: _command,
        separator: _separator,
        timeout: _timeout,
        csv: _csv,
        lines: _lines,
        headers: [],
        rows: [],
        row_count: 0,
        raw_lines: [],
        line_count: 0,
        exit_code: -1,
        last_success: false,
        last_sampled: 0
    };
    const _sensor_name = 'exec_' + _name;
    const _mode = _csv ? 'csv' : 'raw';
    const _properties = '(mode: ' + _mode + ', separator: "' + _separator + '", timeout: ' + _timeout + 'ms' + (_csv ? '' : ', lines: ' + (_lines || 'all')) + ')';
    logger.info(_sensor_name + ': ' + _command + ' ' + _properties);
    config._private = _private;
    return _sensor_name;
}

function stop() {
    return Promise.resolve();
}

/* this will only be used for GUI configuration */
function settings() {
    return {
        name: 'exec',
        description: 'execute a command and parse CSV or raw output',
        icon: 'pi-code',
        multiple: true,
        ident: ['name'],   // which fields will change the identity of the sensor
        fields: [
            { name: 'name', type: 'string', required: true },
            { name: 'command', type: 'string', required: true },
            { name: 'csv', type: 'boolean', value: DEFAULTS.csv },
            { name: 'separator', type: 'string', value: DEFAULTS.separator },
            { name: 'lines', type: 'number', value: DEFAULTS.lines },
            { name: 'timeout', type: 'number', value: DEFAULTS.timeout }
        ]
    };
}

module.exports = {
    init,
    settings,
    sample,
    stop
};
