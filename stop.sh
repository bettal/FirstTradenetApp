#!/bin/bash

killed=false

kill_port() {
    local port=$1
    if command -v ss &>/dev/null; then
        local pids=$(ss -tlnp 2>/dev/null | grep ":${port}\b" | grep -oP 'pid=\K[0-9]+' | sort -u)
        for pid in $pids; do
            kill "$pid" 2>/dev/null && killed=true
        done
    fi
    if command -v lsof &>/dev/null; then
        lsof -ti ":$port" 2>/dev/null | while read -r pid; do
            kill "$pid" 2>/dev/null && killed=true
        done
    fi
}

kill_port "${PORT:-8000}"
kill_port 5173

# Fallback
if ! $killed; then
    pkill -f "python.*backend.py" 2>/dev/null && killed=true
    pkill -f "node.*vite" 2>/dev/null && killed=true
fi

sleep 1

force_kill_port() {
    local port=$1
    if command -v ss &>/dev/null; then
        ss -tlnp 2>/dev/null | grep ":${port}\b" | grep -oP 'pid=\K[0-9]+' | sort -u | xargs -r kill -9 2>/dev/null
    fi
}
force_kill_port "${PORT:-8000}"
force_kill_port 5173

if $killed; then
    echo "Server stopped"
else
    echo "Server was not running"
fi
