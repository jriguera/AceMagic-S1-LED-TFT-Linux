'use strict';
/*!
 * s1panel - widget/service_row
 * Copyright (c) 2025 Jose Riguera
 * GPL-3 Licensed
 */
const node_canvas = require('canvas');
const logger = require('../logger');

// Status colors
const STATUS_COLORS = {
    running: '#00ff00',       // green for running
    failed: '#ff0000',        // red for failed
    stopped: '#808080',       // grey for stopped
    transitioning: '#ffff00', // yellow for recent/activating/deactivating/reloading
    unknown: '#ffffff'        // white for unknown
};

// Default status icons (iconify mdi set)
const STATUS_ICONS = {
    running: 'check-circle',
    failed: 'close-circle',
    stopped: 'stop-circle',
    transitioning: 'loading',
    unknown: 'help-circle'
};

// Time threshold for "recently started" (in milliseconds) - 5 minutes
const DEFAULT_RECENTLY_STARTED_THRESHOLD = 5 * 60 * 1000;
const DEFAULT_ICON_SET = 'mdi';
const DEFAULT_FONT = '12px Arial';

function start_draw(context, rect) {
    context.save();
    context.beginPath();
    context.rect(rect.x, rect.y, rect.width, rect.height);
    context.clip();
}


function debug_rect(context, rect) {
    context.lineWidth = 1;
    context.strokeStyle = "red";
    context.rect(rect.x, rect.y, rect.width, rect.height);
    context.stroke();
}


function replaceRootSVGProperties(svgData, properties) {
    const groups = /^<svg ([^>]*)>/.exec(svgData);
    if (!groups) {
        return svgData;
    }

    const newProperties = [];
    for (let prop of groups[1].split(' ')) {
        let filteredOut = false;
        for (let key in properties) {
            if (prop.match(key)) {
                filteredOut = true;
                break;
            }
        }
        if (!filteredOut) {
            newProperties.push(prop);
        }
    }
    for (let key in properties) {
        const value = properties[key];
        newProperties.push(`${key}='${value}'`);
    }

    return svgData
        .replace(/^<svg [^>]*>/, `<svg ${newProperties.join(' ')}>`)
        .replaceAll(/[\r\n]+/g, '')
        .replaceAll(/fill=[\'\"]currentColor[\'\"]/g, `fill='${properties.fill || "currentColor"}'`);
}


function load_icon(name, iconSet, _private) {
    return new Promise((fulfill, reject) => {
        const slug = `${iconSet}/${name}`;
        if (_private.icons[slug]) {
            return fulfill(_private.icons[slug]);
        }

        const url = `https://api.iconify.design/${slug}.svg`;
        fetch(url).then(response => {
            if (response.status !== 200) {
                logger.error(`error ${response.status} for ${url}`);
                return reject();
            }
            return response.text().then(image => {
                _private.icons[slug] = image;
                return fulfill(image);
            });
        }, error => {
            logger.error(`error ${error} for ${url}`);
            reject();
        }).catch(error => {
            logger.error(`error ${error} for ${url}`);
            reject();
        });
    });
}


function get_private(config) {
    if (!config._private) {
        config._private = {
            icons: {},
            last_value: null
        };
    }
    return config._private;
}


function get_status_color(status, timestamp, config) {
    // Check if recently started (within threshold)
    let transitioning = false;
    if (timestamp > 0) {
        const elapsed_ms = Date.now() - timestamp;
        const threshold = config.recently_threshold || DEFAULT_RECENTLY_STARTED_THRESHOLD;
        if (elapsed_ms < threshold) {
            transitioning = true;
        }
    }
    // Return configured colors or defaults
    switch (status) {
        case 'active':
        case 'running':
            if (transitioning) {
                return config.color_recent || STATUS_COLORS.transitioning;
            } else {
                return config.color_running || STATUS_COLORS.running;
            }
        case 'failed':
        case 'error':
            return config.color_failed || STATUS_COLORS.failed;
        case 'inactive':
        case 'stopped':
            if (transitioning) {
                return config.color_recent || STATUS_COLORS.transitioning;
            } else {
                return config.color_stopped || STATUS_COLORS.stopped;
            }
        case 'activating':
        case 'deactivating':
        case 'reloading':
        case 'transitioning':
            return config.color_transitioning || STATUS_COLORS.transitioning;
        default:
            return config.color_unknown || STATUS_COLORS.unknown;
    }
}

function get_status_icon(status, config) {
    // Allow custom icon override
    if (config.icon) {
        return config.icon;
    }
    // Map systemd status to icon keys
    switch (status) {
        case 'activating':
        case 'deactivating':
        case 'reloading':
        case 'transitioning':
            return STATUS_ICONS.transitioning;
        case 'active':
        case 'running':
            return STATUS_ICONS.running;
        case 'inactive':
        case 'stopped':
            return STATUS_ICONS.stopped;
        case 'failed':
        case 'error':
            return STATUS_ICONS.failed;
        default:
            return STATUS_ICONS.unknown;
    }
}


function draw_icon(context, icon_data, x, y, size, color) {
    return new Promise((fulfill) => {
        const modified_svg = replaceRootSVGProperties(icon_data, {
            width: size,
            height: size,
            fill: color
        });
        node_canvas.loadImage(`data:image/svg+xml,${modified_svg}`).then(loadedImage => {
            context.drawImage(loadedImage, x, y, size, size);
            fulfill(true);
        }, () => {
            fulfill(false);
        });
    });
}


function draw_text(context, text, x, y, width, font, color, align) {
    context.font = font;
    context.fillStyle = color;
    context.textAlign = 'left';
    context.textBaseline = 'top';

    let offset = 0;
    const ruler = context.measureText(text);
    switch (align) {
        case 'center':
            offset = (width / 2) - (ruler.width / 2);
            break;
        case 'right':
            offset = width - ruler.width;
            break;
    }
    // Truncate text if it's too wide
    let display_text = text;
    if (ruler.width > width) {
        while (context.measureText(display_text + '...').width > width && display_text.length > 0) {
            display_text = display_text.slice(0, -1);
        }
        display_text += '...';
        offset = 0; // Left align truncated text
    }
    context.fillText(display_text, x + offset, y);
}


function draw(context, value, min, max, config) {
    return new Promise(fulfill => {
        const _private = get_private(config);
        const _rect = config.rect;

        // Parse service data - value should be JSON from systemd sensor format {0}
        let services = [];
        try {
            services = JSON.parse(value);
        } catch (e) {
            // If not JSON, try to handle as single service or empty
            logger.debug('failed to parse value as JSON: ' + value);
            fulfill(false);
            return;
        }
        // Get the service index to display (default 0)
        const service_index = config.service_index || 0;
        if (service_index >= services.length) {
            fulfill(false);
            return;
        }
        const service = services[service_index];
        const _has_changed = _private.last_value !== value;

        // Column configuration
        // Default columns: icon (col 0), name (col 1), elapsed (col 2)
        const col_widths = config.col_widths || null; // Array of widths or null for equal
        const columns = config.columns || (col_widths ? col_widths.length : 3);
        const col_gap = config.col_gap || 2;
        const icon_size = config.icon_size || Math.min(_rect.height - 2, 16);
        const font = config.font || DEFAULT_FONT;
        const iconSet = config.iconSet || DEFAULT_ICON_SET;

        // Calculate column widths
        let widths = [];
        if (col_widths && col_widths.length >= columns) {
            widths = col_widths.slice(0, columns);
        } else {
            // Default: icon column is icon_size, rest is divided equally
            const remaining_width = _rect.width - icon_size - (col_gap * (columns - 1));
            const text_col_width = remaining_width / (columns - 1);
            widths = [icon_size];
            for (let i = 1; i < columns; i++) {
                widths.push(text_col_width);
            }
        }

        // Determine status color
        const status_color = get_status_color(service.status, service.timestamp, config);
        const icon_name = get_status_icon(service.status, config);

        start_draw(context, _rect);

        // Clear background if specified
        if (config.background) {
            context.fillStyle = config.background;
            context.fillRect(_rect.x, _rect.y, _rect.width, _rect.height);
        }

        // Calculate column positions
        let x_pos = _rect.x;
        const y_center = _rect.y + (_rect.height - icon_size) / 2;
        const y_text = _rect.y + (_rect.height - parseInt(font)) / 2;

        // Load and draw icon
        load_icon(icon_name, iconSet, _private).then(icon_data => {
            // Column 0: Icon
            if (columns > 0) {
                return draw_icon(context, icon_data, x_pos, y_center, icon_size, status_color);
            }
            return Promise.resolve();
        }).then(() => {
            x_pos += widths[0] + col_gap;

            // Column 1: Service name
            if (columns > 1) {
                const name = service.display_name || service.service;
                draw_text(context, name, x_pos, y_text, widths[1], font, status_color, config.name_align || 'left');
                x_pos += widths[1] + col_gap;
            }

            // Column 2: Elapsed time
            if (columns > 2) {
                const elapsed = service.elapsed || '-';
                draw_text(context, elapsed, x_pos, y_text, widths[2], font, status_color, config.elapsed_align || 'right');
                x_pos += widths[2] + col_gap;
            }

            // Column 3+: Additional custom columns (status label, description, etc.)
            if (columns > 3) {
                const extra_fields = config.extra_fields || ['label'];
                for (let i = 3; i < columns && (i - 3) < extra_fields.length; i++) {
                    const field_name = extra_fields[i - 3];
                    const field_value = service[field_name] || '';
                    draw_text(context, field_value, x_pos, y_text, widths[i], font, status_color, 'left');
                    x_pos += widths[i] + col_gap;
                }
            }

            if (config.debug_frame) {
                debug_rect(context, _rect);
            }

            context.restore();

            if (_has_changed) {
                _private.last_value = value;
            }
            fulfill(_has_changed);

        }).catch(() => {
            // Icon loading failed, draw without icon
            x_pos += widths[0] + col_gap;

            // Column 1: Service name
            if (columns > 1) {
                const name = service.display_name || service.service;
                draw_text(context, name, x_pos, y_text, widths[1], font, status_color, config.name_align || 'left');
                x_pos += widths[1] + col_gap;
            }

            // Column 2: Elapsed time
            if (columns > 2) {
                const elapsed = service.elapsed || '-';
                draw_text(context, elapsed, x_pos, y_text, widths[2], font, status_color, config.elapsed_align || 'right');
            }

            if (config.debug_frame) {
                debug_rect(context, _rect);
            }

            context.restore();

            if (_has_changed) {
                _private.last_value = value;
            }
            fulfill(_has_changed);
        });
    });
}


function info() {
    return {
        name: 'service_row',
        description: 'A table row displaying systemd service status with icon, name, and elapsed time',
        fields: [
            { name: 'service_index', value: 'number' },
            { name: 'columns', value: 'number' },
            { name: 'col_widths', value: 'array' },
            { name: 'col_gap', value: 'number' },
            { name: 'icon_size', value: 'number' },
            { name: 'font', value: 'font' },
            { name: 'iconSet', value: 'list:mdi,material-symbols,simple-icons' },
            { name: 'icon', value: 'string' },
            { name: 'name_align', value: 'list:left,center,right' },
            { name: 'elapsed_align', value: 'list:left,center,right' },
            { name: 'color_running', value: 'color' },
            { name: 'color_failed', value: 'color' },
            { name: 'color_stopped', value: 'color' },
            { name: 'color_unknown', value: 'color' },
            { name: 'color_transitioning', value: 'color' },
            { name: 'color_recent', value: 'color' },
            { name: 'recently_threshold', value: 'number' },
            { name: 'background', value: 'color' },
            { name: 'extra_fields', value: 'array' }
        ]
    };
}


module.exports = {
    info,
    draw
};
