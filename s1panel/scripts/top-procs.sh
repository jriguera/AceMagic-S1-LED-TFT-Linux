#!/usr/bin/env bash
#
# s1panel - Top processes by CPU usage
# Copyright (c) 2026 Jose Riguera
# GPL-3 Licensed
#
# top-procs.sh - Returns top 10 processes by CPU usage
# Output format: CSV with semicolon separator
# 
# Rows 0-9: Top 10 processes by CPU usage  
#   Columns: pid, name, cpu_pct, mem_pct
#
# Usage in config.json:
#   {
#     "name": "top_procs",
#     "type": "exec",
#     "enabled": true,
#     "script": "../top-procs.sh",
#     "csv": true,
#     "separator": ";"
#   }
#
# Access in widgets:
#   Process 1:  {0.name} ({0.cpu_pct}% CPU, {0.mem_pct}% MEM)
#   Process 2:  {1.name} ({1.cpu_pct}% CPU, {1.mem_pct}% MEM)
#   ...
#   Process 10: {9.name} ({9.cpu_pct}% CPU, {9.mem_pct}% MEM)

# Header
echo "pid;name;cpu_pct;mem_pct"

# Get top 10 processes by CPU using awk (skip ps command itself)
ps -eo pid=,comm=,%cpu=,%mem= --sort=-%cpu --no-headers 2>/dev/null | \
    awk '$2!="ps" && $2!="awk" && NR<=12 {gsub(/^ +| +$/, ""); print $1";"$2";"$3";"$4; count++} count>=10 {exit}'
