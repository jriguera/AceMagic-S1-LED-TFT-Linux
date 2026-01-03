#!/usr/bin/env bash
# Script to query failed systemd services and output CSV format
# Columns: service,code,message,failed_at

echo "service;code;message;activestate;activeicon;unitfilestate;unitfileicon;timestamp"

# Get list of failed services
failed_services=$(systemctl --failed --no-legend --plain | awk '{print $1}')
[[ -z "$failed_services" ]] && exit 0

# For each failed service, get details
while IFS= read -r service; do
    if [ -n "$service" ]; then
        # Get service properties
        props=$(systemctl show "$service" --property=Result,ExecMainStatus,StatusText,ActiveState,UnitFileState,InactiveEnterTimestamp 2>/dev/null)
        # Parse properties
        result=$(echo "$props" | grep "^Result=" | cut -d'=' -f2-)
        exit_code=$(echo "$props" | grep "^ExecMainStatus=" | cut -d'=' -f2-)
        status_text=$(echo "$props" | grep "^StatusText=" | cut -d'=' -f2-)
        timestamp=$(echo "$props" | grep "^InactiveEnterTimestamp=" | cut -d'=' -f2-)
        active_state=$(echo "$props" | grep "^ActiveState=" | cut -d'=' -f2-)
        unit_file_state=$(echo "$props" | grep "^UnitFileState=" | cut -d'=' -f2-)
        # Clean up service name (remove .service suffix)
        service_name="${service%.service}"
        # Use result as message if status_text is empty
        [[ -z "$status_text" ]] && status_text="$result"
        # Remove commas from status_text to avoid CSV issues
        status_text=$(echo "$status_text" | tr ';' ',')
        # Format timestamp (extract just time part if available)
        if [ -n "$timestamp" ] && [ "$timestamp" != "n/a" ]
        then
            # Extract time portion (HH:MM:SS) from timestamp like "Mon 2025-12-23 10:30:45 CET"
            failed_time="${timestamp}"
        else
            failed_time="-"
        fi
        # Default exit code if empty
        [[ -z "$exit_code" ]] && exit_code="1"
        # Map ActiveState to icon
        case "$active_state" in
            active)       active_icon="▶" ;;    # Running/active
            inactive)     active_icon="⏹" ;;    # Stopped
            failed)       active_icon="✖" ;;    # Failed
            activating)   active_icon="⇧" ;;    # Starting up (upward arrow)
            deactivating) active_icon="⇩" ;;    # Shutting down (downward arrow)
            reloading)    active_icon="↻" ;;    # Reloading (circular arrow)
            *)            active_icon="?" ;;    # Unknown
        esac
        # Map UnitFileState to icon
        case "$unit_file_state" in
            enabled)         unit_file_icon="✔" ;;    # Enabled to start at boot
            disabled)        unit_file_icon="○" ;;    # Disabled
            static)          unit_file_icon="◆" ;;    # Cannot be enabled/disabled (dependency only)
            masked)          unit_file_icon="⊘" ;;    # Completely disabled
            linked)          unit_file_icon="⤤" ;;    # Symlinked from another location (arrow pointing to corner)
            transient)       unit_file_icon="∿" ;;    # Dynamically created (sine wave)
            indirect)        unit_file_icon="↪" ;;    # Enabled indirectly via Also=
            generated)       unit_file_icon="⚙" ;;    # Auto-generated
            enabled-runtime) unit_file_icon="▶" ;;    # Enabled only for this boot
            bad)             unit_file_icon="⚠" ;;    # Unit file is invalid
            *)               unit_file_icon="?" ;;    # Unknown
        esac
        # Output in CSV format
        echo "${service_name};${exit_code};${status_text};${active_state};${active_icon};${unit_file_state};${unit_file_icon};${failed_time}"
    fi
done <<< "$failed_services"
