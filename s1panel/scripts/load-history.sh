#!/usr/bin/env bash
#
# s1panel - Load average history tracker
# Copyright (c) 2026 Jose Riguera
# GPL-3 Licensed
#
# Keeps 16 samples of 5-minute load average (80 minutes total)
# Each sample represents a 5-minute window
# Output format: CSV with header for current values + comma-separated history for bar_chart

# Use XDG_RUNTIME_DIR if available, otherwise /tmp
RUNTIME_DIR="/run/s1panel"
DB_FILE="${RUNTIME_DIR}/load_history.dat"
LOCK_FILE="${RUNTIME_DIR}/load_history.lock"
MAX_SAMPLES=16
UPDATE_INTERVAL=300  # 5 minutes in seconds

# Create lock to prevent concurrent updates
mkdir -p "$RUNTIME_DIR"
exec 200>"$LOCK_FILE"
flock -n 200 || {
    # Another instance is running, just output current data if available
    if [[ -f "$DB_FILE" ]]; then
        source "$DB_FILE"
        read LOAD1 LOAD5 LOAD15 _ _ < /proc/loadavg
        echo "load1;load5;load15;history"
        printf "%.2f;%.2f;%.2f;%s\n" "$LOAD1" "$LOAD5" "$LOAD15" "$HISTORY_LOAD5"
    fi
    exit 0
}

# Initialize DB if it doesn't exist
if [[ ! -f "$DB_FILE" ]]; then
    # Create initial data file with zeros
    ZEROS=""
    for ((i=0; i<MAX_SAMPLES; i++)); do
        [[ -n "$ZEROS" ]] && ZEROS+=","
        ZEROS+="0"
    done
    cat > "$DB_FILE" << EOF
HISTORY_LOAD5="$ZEROS"
EOF
fi

# Source current data (for history)
source "$DB_FILE"

# Always read current load averages from /proc/loadavg
read LOAD1 LOAD5 LOAD15 _ _ < /proc/loadavg
CURRENT_LOAD1=$(printf "%.2f" "$LOAD1")
CURRENT_LOAD5=$(printf "%.2f" "$LOAD5")
CURRENT_LOAD15=$(printf "%.2f" "$LOAD15")

# Check if we need to update history (last modification > UPDATE_INTERVAL seconds ago)
CURRENT_TIME=$(date +%s)
LAST_MOD=$(stat -c %Y "$DB_FILE" 2>/dev/null || echo 0)
TIME_DIFF=$((CURRENT_TIME - LAST_MOD))

if [[ $TIME_DIFF -ge $UPDATE_INTERVAL ]]; then
    # Parse existing history into array
    IFS=',' read -ra HISTORY_ARRAY <<< "$HISTORY_LOAD5"
    
    # Shift array: remove first element (oldest), add new one at the end (newest)
    # This keeps oldest on the left, newest on the right (matching cpu_usage flow)
    NEW_HISTORY=""
    for ((i=1; i<${#HISTORY_ARRAY[@]}; i++)); do
        [[ -n "$NEW_HISTORY" ]] && NEW_HISTORY+=","
        NEW_HISTORY+="${HISTORY_ARRAY[$i]}"
    done
    [[ -n "$NEW_HISTORY" ]] && NEW_HISTORY+=","
    NEW_HISTORY+="$CURRENT_LOAD5"
    HISTORY_LOAD5="$NEW_HISTORY"
    
    # Save updated history
    cat > "$DB_FILE" << EOF
HISTORY_LOAD5="$HISTORY_LOAD5"
EOF
fi

# Output CSV format for s1panel
echo "load1;load5;load15;history"
echo "${CURRENT_LOAD1};${CURRENT_LOAD5};${CURRENT_LOAD15};${HISTORY_LOAD5}"
