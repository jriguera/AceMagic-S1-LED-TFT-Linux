#!/usr/bin/env bash
#
# s1panel - LED strip controller
# Copyright (c) 2026 Jose Riguera
# GPL-3 Licensed
#
# Enhanced LED strip control script with better error handling,
# validation, and user-friendly interface

set -euo pipefail

# Default values
THEME=4        # off
INTENSITY=3
SPEED=3
HOST="localhost"
PORT=8181

# Theme mappings
declare -A THEME_NAMES=(
    [1]="rainbow"
    [2]="breathing"
    [3]="color-cycle"
    [4]="off"
    [5]="auto"
)

declare -A THEME_IDS=(
    ["rainbow"]=1
    ["breathing"]=2
    ["color-cycle"]=3
    ["off"]=4
    ["auto"]=5
)

# Usage information
usage() {
    cat <<-EOF
	Usage: $(basename "$0") [COMMAND] [VALUE] [OPTIONS]

	Enhanced LED strip controller for s1panel

	COMMANDS:
	    theme VALUE         Set theme: 1-5 or name (rainbow, breathing, color-cycle, off, auto)
	    intensity VALUE     Set intensity level: 1-10
	    speed VALUE         Set speed level: 1-10

	OPTIONS:
	    -H, --host HOST     API host (default: localhost)
	    -p, --port PORT     API port (default: 8181)
	    -l, --list          List available themes
	    -h, --help          Show this help message

	EXAMPLES:
	    # Turn off LED strip
	    $(basename "$0") theme off

	    # Set rainbow theme
	    $(basename "$0") theme rainbow

	    # Set intensity
	    $(basename "$0") intensity 8

	    # Set speed
	    $(basename "$0") speed 5

	    # Check current status (no arguments)
	    $(basename "$0")

	    # Use custom host/port
	    $(basename "$0") theme rainbow --host 192.168.1.100 --port 8080

	EOF
}

# List available themes
list_themes() {
    echo "Available LED strip themes:"
    for id in "${!THEME_NAMES[@]}"
    do
        echo "  $id: ${THEME_NAMES[$id]}"
    done | sort -n
}

# Validate numeric range
validate_range() {
    local value=$1
    local min=$2
    local max=$3
    local name=$4
    
    if [[ ! "$value" =~ ^[0-9]+$ ]]
    then
        echo "ERROR: $name must be a number" >&2
        return 1
    fi
    if (( value < min || value > max ))
    then
        echo "ERROR: $name must be between $min and $max (got: $value)" >&2
        return 1
    fi
    echo "$value"
    return 0
}

# Parse theme argument (number or name)
validate_theme() {
    local input=$1

    # Check if it's a number
    if [[ "$input" =~ ^[0-9]+$ ]]
    then
        if (( input >= 1 && input <= 5 ))
        then
            echo "$input"
            return 0
        else
            echo "ERROR: Theme ID must be between 1 and 5" >&2
            return 1
        fi
    fi
    # Check if it's a theme name
    if [[ -n "${THEME_IDS[$input]:-}" ]]
    then
        echo "${THEME_IDS[$input]}"
        return 0
    fi
    echo "ERROR: Invalid theme: $input" >&2
    echo "Use --list to see available themes" >&2
    return 1
}

# Get current LED strip status
get_status() {
    if ! response=$(curl -s -f "$API_URL" 2>&1)
    then
        echo "ERROR: Failed to get LED strip status" >&2
        echo "Is s1panel running on ${HOST}:${PORT}?" >&2
        return 1
    fi
    echo "Status:"
    echo "$response" | jq -r 'to_entries | .[] | "\t\(.key)=\(.value)"'
}

# Send LED strip configuration
set_led_strip() {
	local json_data=$(cat <<-EOF
		{
		  "theme": $THEME,
		  "intesity": $INTENSITY,
		  "speed": $SPEED
		}
	EOF
    )
    if ! response=$(curl -s -f -X POST "$API_URL" -H 'Content-Type: application/json' -d "$json_data" 2>&1)
    then
        echo "ERROR: Failed to set LED strip configuration" >&2
        echo "Is s1panel running on ${HOST}:${PORT}?" >&2
        return 1
    fi
    echo "LED strip configured: ${THEME_NAMES[$THEME]}"
    echo "Status:"
    echo "$response" | jq -r 'to_entries | .[] | "\t\(.key)=\(.value)"'
}

# Main script logic
ACTION="get"

while [[ $# -gt 0 ]]
do
    case $1 in
        theme)
            if [[ -z "${2:-}" ]]
            then
                echo "ERROR: theme requires a value" >&2
                exit 1
            fi
            THEME=$(validate_theme "$2") || exit 1
            ACTION="set"
            shift 2
            ;;
        intensity)
            if [[ -z "${2:-}" ]]
            then
                echo "ERROR: intensity requires a value" >&2
                exit 1
            fi
            INTENSITY=$(validate_range "$2" 1 10 "Intensity") || exit 1
            ACTION="set"
            shift 2
            ;;
        speed)
            if [[ -z "${2:-}" ]]
            then
                echo "ERROR: speed requires a value" >&2
                exit 1
            fi
            SPEED=$(validate_range "$2" 1 10 "Speed") || exit 1
            ACTION="set"
            shift 2
            ;;
        -H|--host)
            HOST=$2
            shift 2
            ;;
        -p|--port)
            PORT=$2
            shift 2
            ;;
        -l|--list)
            list_themes
            exit 0
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "ERROR: Unknown command or option: $1" >&2
            echo
            usage
            exit 1
            ;;
    esac
done

# Build API URL after parsing arguments
API_URL="http://${HOST}:${PORT}/api/led_strip"

# Execute action
[[ "$ACTION" == "get" ]] && get_status || set_led_strip