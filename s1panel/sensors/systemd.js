'use strict';
/*!
 * s1panel - sensor/systemd
 * Copyright (c) 2025 Jose Riguera
 * GPL-3 Licensed
 */
const { exec } = require('child_process');

const logger = require('../logger');

var _fault = false;

// Status labels
const STATUS_LABELS = {
    active: 'running',
    failed: 'failed',
    inactive: 'stopped',
    activating: 'starting',
    deactivating: 'stopping',
    reloading: 'reloading',
    unknown: 'unknown'
};

// Status symbols/icons
const STATUS_SYMBOLS = {
    active: '●',
    failed: '✗',
    inactive: '○',
    activating: '◐',
    deactivating: '◑',
    reloading: '↻',
    unknown: '?'
};

function format_elapsed_time(timestamp_ms) {
    if (!timestamp_ms || timestamp_ms === 0) {
        return '-';
    }
    const _now = Date.now();
    const _elapsed_ms = _now - timestamp_ms;
    const _elapsed_sec = Math.floor(_elapsed_ms / 1000);
    if (_elapsed_sec < 0) {
        return '-';
    }
    const _days = Math.floor(_elapsed_sec / 86400);
    const _hours = Math.floor((_elapsed_sec % 86400) / 3600);
    const _minutes = Math.floor((_elapsed_sec % 3600) / 60);
    const _seconds = _elapsed_sec % 60;
    if (_days > 0) {
        return `${_days}d ${_hours}h`;
    } else if (_hours > 0) {
        return `${_hours}h ${_minutes}m`;
    } else if (_minutes > 0) {
        return `${_minutes}m ${_seconds}s`;
    } else {
        return `${_seconds}s`;
    }
}

function parse_systemd_timestamp(timestamp_str) {
    // systemctl show returns timestamps like "Tue 2025-12-02 22:14:21 CET"
    // or empty string if not set
    if (!timestamp_str || timestamp_str === '' || timestamp_str === 'n/a') {
        return 0;
    }
    // Remove the day name prefix (e.g., "Tue ") if present
    // Format: "Day YYYY-MM-DD HH:MM:SS TZ"
    const _parts = timestamp_str.split(' ');
    if (_parts.length >= 3) {
        // Try to parse "YYYY-MM-DD HH:MM:SS" part
        const _date_str = _parts.slice(1, 3).join(' '); // "2025-12-02 22:14:21"
        const _date = new Date(_date_str);
        if (!isNaN(_date.getTime())) {
            return _date.getTime();
        }
    }
    // Fallback: try parsing the whole string
    const _date = new Date(timestamp_str);
    if (!isNaN(_date.getTime())) {
        return _date.getTime();
    }
    return 0;
}

function parse_systemctl_show(output) {
    const _props = {};
    const _lines = output.split('\n');

    for (const line of _lines) {
        const _eq_index = line.indexOf('=');
        if (_eq_index > 0) {
            const _key = line.substring(0, _eq_index);
            const _value = line.substring(_eq_index + 1);
            _props[_key] = _value;
        }
    }
    return _props;
}


function get_service_status(service, strip_prefix) {

    return new Promise(fulfill => {
        // Get comprehensive service information using systemctl show
        const _properties = [
            'ActiveState',
            'SubState', 
            'StateChangeTimestamp',
            'ActiveEnterTimestamp',
            'ActiveExitTimestamp',
            'InactiveEnterTimestamp',
            'InactiveExitTimestamp',
            'Description',
            'LoadState',
            'Result',
            'ExecMainStatus',
            'ExecMainCode'
        ].join(',');

        exec(`systemctl show ${service} --property=${_properties}`, (error, stdout, stderr) => {

            const _props = parse_systemctl_show(stdout);
            const _active_state = _props.ActiveState || 'unknown';
            const _sub_state = _props.SubState || '';
            const _load_state = _props.LoadState || '';
            const _result = _props.Result || '';
            const _description = _props.Description || service;
            const _exec_main_status = _props.ExecMainStatus || '';
            const _exec_main_code = _props.ExecMainCode || '';
            
            // Determine the relevant timestamp based on state
            let _state_timestamp = '';
            if (_active_state === 'active') {
                _state_timestamp = _props.ActiveEnterTimestamp || '';
            } else if (_active_state === 'failed') {
                _state_timestamp = _props.InactiveEnterTimestamp || _props.StateChangeTimestamp || '';
            } else if (_active_state === 'inactive') {
                _state_timestamp = _props.InactiveEnterTimestamp || '';
            } else {
                _state_timestamp = _props.StateChangeTimestamp || '';
            }
            // Parse timestamp to milliseconds
            const _timestamp_ms = parse_systemd_timestamp(_state_timestamp);
            const _elapsed = format_elapsed_time(_timestamp_ms);
            
            // Strip prefix from service name for display
            let _display_name = service;
            if (strip_prefix && service.startsWith(strip_prefix)) {
                _display_name = service.substring(strip_prefix.length);
                // Remove leading dash if present
                if (_display_name.startsWith('-')) {
                    _display_name = _display_name.substring(1);
                }
            }
            
            fulfill({
                service: service,
                display_name: _display_name,
                description: _description,
                status: _active_state,
                sub_state: _sub_state,
                load_state: _load_state,
                result: _result,
                exec_main_status: _exec_main_status,
                exec_main_code: _exec_main_code,
                label: STATUS_LABELS[_active_state] || STATUS_LABELS.unknown,
                symbol: STATUS_SYMBOLS[_active_state] || STATUS_SYMBOLS.unknown,
                elapsed: _elapsed,
                timestamp: _timestamp_ms
            });
        });
    });
}

function get_all_services_status(services, strip_prefix) {

    return new Promise(fulfill => {
        const _promises = services.map(service => get_service_status(service, strip_prefix));
        Promise.all(_promises).then(results => {
            fulfill(results);
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
            _promise = get_all_services_status(_private.services, _private.strip_prefix);
            _dirty = true;
        }

        _promise.then(results => {

            if (_dirty && results) {
                _private.status_cache = results;
            }
            const _results = _private.status_cache || [];

            const _output = format.replace(/{(\d+)}/g, function (match, number) {

                const _index = parseInt(number);
                // Format codes:
                // {0} - JSON array of all services status
                // {1} - Number of services monitored
                // {2} - Number of services running
                // {3} - Number of services failed
                // {4} - Number of services stopped
                // {5} - Formatted text: "service1:status,service2:status,..."
                // {6} - Formatted text with elapsed: "service1:elapsed,service2:elapsed,..."
                // {7} - All services with symbols: "● service1, ✗ service2, ..."
                // {8} - Summary line: "2/5 running, 1 failed"
                // {10+} - Individual service status:
                //         (10=service 0 display name, 11=service 0 status, 12=service 0 elapsed, 13=service 0 label, 14=service 0 symbol)
                //         (15=service 1 display name, 16=service 1 status, 17=service 1 elapsed, 18=service 1 label, 19=service 1 symbol)
                //         etc. (5 fields per service)
                switch (_index) {
                    case 0:
                        return JSON.stringify(_results);
                    case 1:
                        return _results.length;
                    case 2:
                        return _results.filter(r => r.status === 'active').length;
                    case 3:
                        return _results.filter(r => r.status === 'failed').length;
                    case 4:
                        return _results.filter(r => r.status === 'inactive').length;
                    case 5:
                        return _results.map(r => `${r.display_name}:${r.label}`).join(',');
                    case 6:
                        return _results.map(r => `${r.display_name}:${r.elapsed}`).join(',');
                    case 7:
                        return _results.map(r => `${r.symbol} ${r.display_name}`).join(', ');
                    case 8: {
                        const _running = _results.filter(r => r.status === 'active').length;
                        const _failed = _results.filter(r => r.status === 'failed').length;
                        let _summary = `${_running}/${_results.length} running`;
                        if (_failed > 0) {
                            _summary += `, ${_failed} failed`;
                        }
                        return _summary;
                    }

                    default:
                        // Individual service access starting at index 10
                        // 5 fields per service: display_name, status, elapsed, label, symbol
                        if (_index >= 10) {
                            const _service_index = Math.floor((_index - 10) / 5);
                            const _field_index = (_index - 10) % 5;

                            if (_service_index < _results.length) {
                                const _service = _results[_service_index];
                                switch (_field_index) {
                                    case 0:
                                        return _service.display_name;  // display name (stripped prefix)
                                    case 1:
                                        return _service.status;        // raw status (active, inactive, failed)
                                    case 2:
                                        return _service.elapsed;       // elapsed time since state change
                                    case 3:
                                        return _service.label;         // human label (running, stopped, failed)
                                    case 4:
                                        return _service.symbol;        // symbol (●, ○, ✗)
                                }
                            }
                        }
                        return 'undefined';
                }
            });

            fulfill({ value: _output, min: 0, max: _results.length });
        });
    });
}

function init(config) {

    const _services = config?.services || [];

    const _private = {
        name: config?.name || 'default',
        services: _services,
        strip_prefix: config?.strip_prefix || null,
        status_cache: [],
        last_sampled: 0
    };

    if (_services.length === 0) {
        logger.warn('systemd: no services configured to monitor');
    } else {
        logger.info('systemd: monitoring ' + _services.length + ' services: ' + _services.join(', '));
    }

    config._private = _private;

    return 'systemd_' + _private.name;
}

function stop() {
    return Promise.resolve();
}

/* this will only be used for GUI configuration */
function settings() {
    return {
        name: 'systemd',
        description: 'monitor systemd services status',
        icon: 'pi-server',
        multiple: true,
        ident: ['name'],   // which fields will change the identity of the sensor
        fields: [
            { name: 'name', type: 'string', value: 'default' },
            { name: 'services', type: 'array', value: [] },
            { name: 'strip_prefix', type: 'string', value: '' }
        ]
    };
}

module.exports = {
    init,
    settings,
    sample,
    stop
};
