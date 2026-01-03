'use strict';
/*!
 * s1panel - widget/threshold_doughnut_chart
 * Copyright (c) 2024-2025 Tomasz Jaworski
 * Copyright (c) 2025 Jose Riguera
 * GPL-3 Licensed
 * 
 * A doughnut chart widget that changes color based on value thresholds.
 * Extends the original doughnut_chart with dynamic color support.
 * 
 * Usage example in theme JSON:
 * {
 *    "id": 1,
 *    "group": 1,
 *    "name": "threshold_doughnut_chart",
 *    "used": "#00e600",
 *    "free": "#4d4d4d",
 *    "thresholds": [
 *       { "value": 0, "color": "#00e600" },
 *       { "value": 50, "color": "#ffcc00" },
 *       { "value": 75, "color": "#ff9500" },
 *       { "value": 90, "color": "#ff3333" }
 *    ],
 *    "rect": {
 *       "x": 10,
 *       "y": 25,
 *       "width": 70,
 *       "height": 70
 *    },
 *    "sensor": true,
 *    "value": "cpu_usage",
 *    "format": "{0}",
 *    "refresh": 1000,
 *    "debug_frame": false
 * }
 * 
 * Thresholds array defines color changes based on value:
 * - value: The minimum value at which this color activates
 * - color: The hex color to use when value >= threshold value
 * 
 * If thresholds is not provided, default thresholds are used:
 * - 0-49%:  Green  (#00e600)
 * - 50-74%: Yellow (#ffcc00)
 * - 75-89%: Orange (#ff9500)
 * - 90%+:   Red    (#ff3333)
 */
const logger = require('../logger');

const { loadImage }         = require('canvas');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

// Default thresholds: green -> yellow -> orange -> red
const DEFAULT_THRESHOLDS = [
    { value: 0,  color: '#00e600' },  // Green (0-49%)
    { value: 50, color: '#ffcc00' },  // Yellow (50-74%)
    { value: 75, color: '#ff9500' },  // Orange (75-89%)
    { value: 90, color: '#ff3333' }   // Red (90-100%)
];

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

function draw_chart(context, x, y, chart, config) {
    return new Promise((fulfill, reject) => {
        chart.renderToBuffer(config).then(buffer => {
            loadImage(buffer).then(image => {
                context.drawImage(image, x, y);
                fulfill();
            }, reject);
        }, reject);
    });
}

function get_private(config) {
    if (!config._private) {
        config._private = {};
    }
    return config._private;
}

/**
 * Determine the color based on value and thresholds.
 * Thresholds should be sorted by value ascending.
 * Returns the color of the highest threshold that the value meets or exceeds.
 */
function get_threshold_color(value, thresholds, defaultColor) {
    if (!thresholds || !Array.isArray(thresholds) || thresholds.length === 0) {
        thresholds = DEFAULT_THRESHOLDS;
    }
    
    // Sort thresholds by value descending to find the highest matching threshold
    const sortedThresholds = [...thresholds].sort((a, b) => b.value - a.value);
    
    for (const threshold of sortedThresholds) {
        if (Number(value) >= threshold.value) {
            return threshold.color;
        }
    }
    
    // If no threshold matched, return the default or the lowest threshold color
    return defaultColor || thresholds[0]?.color || '#48BB78';
}

function draw(context, value, min, max, config) {
    return new Promise(fulfill => {
        const _private = get_private(config);
        const _rect = config.rect;
        const _has_changed = (_private.last_value !== value) ? true : false;
        const _points = [ Number(value) - min, Number(max) - Number(value) ];
        const _labels = [ 'used', 'unused '];

        // Get dynamic color based on thresholds
        const _used_color = get_threshold_color(value, config.thresholds, config.used);

        const _configuration = {
            type: 'doughnut',
            data: {
                labels: _labels,
                datasets: [{
                    label           : '',
                    data            : _points,
                    backgroundColor : [_used_color, (config.free || '#EDF2F7')],
                    borderColor     : config.free,
                    rotation        : config.rotation || 225,
                    cutout          : config.cutout || '80%',
                    circumference   : config.circumference || 270,
                }]
            },
            options: {
                plugins: {
                    legend: {
                      display: false
                    }
                },
                responsive: true,
                layout: { 
                    padding: { 
                        bottom: 0,
                        top: 0
                    } 
                },               
                legend: {
                    display: false
                }
            }
        };

        if (!_private.chart || _private.chart._width != _rect.width || _private.chart._height != _rect.height) {
            if (_private.chart) {
                delete _private.chart;
            }
            _private.chart = new ChartJSNodeCanvas({ width: _rect.width, height: _rect.height });
        }

        start_draw(context, _rect);

        draw_chart(context, _rect.x, _rect.y, _private.chart, _configuration).then(() => {
            if (_has_changed) {
                _private.last_value = value;
            }
        }, () => {
            logger.error('threshold_doughnut_chart draw failed');
        }).finally(() => {
            if (config.debug_frame) {
                debug_rect(context, _rect);
            }
            context.restore();
            fulfill(_has_changed);
        });       
    }); 
}

function info() {
    return {
        name: 'threshold_doughnut_chart',
        description: 'A doughnut chart with dynamic color based on value thresholds',
        fields: [ 
            { name: 'used', value: 'color', description: 'Default/fallback color for used portion' }, 
            { name: 'free', value: 'color', description: 'Color for unused portion' }, 
            { name: 'thresholds', value: 'array', description: 'Array of {value, color} objects for dynamic coloring' },
            { name: 'rotation', value: 'string' }, 
            { name: 'cutout', value: 'string' }, 
            { name: 'circumference', value: 'string' } 
        ]
    };
}

module.exports = {
    info,
    draw
};
