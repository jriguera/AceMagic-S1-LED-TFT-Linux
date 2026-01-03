#!/usr/bin/env bash
# Script to query filesystem usage and output CSV format
# Uses lsblk to get block device info with mount points
# Columns: name,size,use_pct,use_pct_num,mountpoint,icon

echo "name;size;use_pct;use_pct_num;mountpoint;icon"

# Get filesystem usage from lsblk
# -P = key=value pairs, -n = no header
# Only show devices with mountpoints (actual mounted filesystems)
while IFS= read -r line
do
    # Parse the key=value format from lsblk -P
    # Replace FSUSE% with FSUSE to avoid bash issues
    line="${line//FSUSE%=/FSUSE=}"
    eval "$line"
    # Skip entries without mountpoints
    [[ -z "$MOUNTPOINTS" ]] && continue
    # Skip pseudo filesystems, special mounts, and swap
    case "$MOUNTPOINTS" in
        /sys*|/proc*|/dev*|/run/user*|/snap/*|/var/lib/docker/*|/boot/efi|\[SWAP\])
            continue
        ;;
    esac
    
    # Get numeric percentage (remove % sign if present)
    use_pct_num="${FSUSE%\%}"
    use_pct_num="${use_pct_num:-0}"
    # Format use percentage with % sign
    use_pct="${use_pct_num}%"
    
    # Determine icon based on usage percentage
    if [[ "$use_pct_num" =~ ^[0-9]+$ ]]
    then
        if [[ $use_pct_num -ge 90 ]]
        then
            icon="●"    # Critical (red dot)
        elif [[ $use_pct_num -ge 75 ]]
        then
            icon="◐"    # Warning (half moon)
        elif [[ $use_pct_num -ge 50 ]]
        then
            icon="◑"    # Medium (half moon)
        else
            icon="○"    # Good (empty circle)
        fi
    else
        icon="?"
        use_pct_num="0"
    fi
    # Clean up name - use device name
    name="${NAME}"
    
    # Shorten mountpoint for display
    case "$MOUNTPOINTS" in
        /)
            mount_display="/"
            ;;
        /home)
            mount_display="/home"
            ;;
        *)
            # Show last part of path if too long
            if [[ ${#MOUNTPOINTS} -gt 12 ]]; then
                mount_display="..${MOUNTPOINTS: -10}"
            else
                mount_display="$MOUNTPOINTS"
            fi
            ;;
    esac
    
    # Output in CSV format (semicolon separated)
    echo "${name};${SIZE};${use_pct};${use_pct_num};${mount_display};${icon}"

done < <(lsblk -o NAME,SIZE,FSUSE%,MOUNTPOINTS -P -n 2>/dev/null | grep -v "MOUNTPOINTS=\"\"")
