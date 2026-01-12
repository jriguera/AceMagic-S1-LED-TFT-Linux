#!/usr/bin/env bash
#
# s1panel - Journal log messages
# Copyright (c) 2026 Jose Riguera
# GPL-3 Licensed
#
# journal-syslog.sh - Returns recent journal log messages
# Output format: CSV with semicolon separator
# 
# Each row contains a single log message (cleaned)
#   Columns: message
#
# Usage in config.json:
#
#        module = "sensors/exec.js";
#        config = {
#          name = "journal";
#          command = "scripts/journal-syslog.sh 33 podman";
#          timeout = 5000;
#        };
#
# Access in widgets:
#   Message 1:  {0.message}
#   Message 2:  {1.message}
#   ...
#   Message N:  {N.message}

set -euo pipefail

# Default number of lines
LINES="${1:-33}"

# Excluded identifiers (space-separated list, empty by default)
EXCLUDE_IDENTIFIERS="${2:-}"

# Build jq filter for exclusions
EXCLUDE_FILTER=""
for ident in $EXCLUDE_IDENTIFIERS
do
    if [[ -n "$EXCLUDE_FILTER" ]]
    then
        EXCLUDE_FILTER="$EXCLUDE_FILTER and "
    fi
    EXCLUDE_FILTER="${EXCLUDE_FILTER}.SYSLOG_IDENTIFIER!=\"$ident\""
done

# Build the full jq expression
if [[ -n "$EXCLUDE_FILTER" ]]
then
    JQ_EXPR="select($EXCLUDE_FILTER) | .MESSAGE | gsub(\"^\\\\s+|\\\\s+$|\\\\n\"; \"\")"
else
    JQ_EXPR=".MESSAGE | gsub(\"^\\\\s+|\\\\s+$|\\\\n\"; \"\")"
fi

# Get journal entries, filter and clean messages
journalctl -n "$LINES" -o json 2>/dev/null | jq -r "$JQ_EXPR" 2>/dev/null || true
