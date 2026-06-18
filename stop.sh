#!/bin/bash

# ── Kill by port (most reliable) ─────────────────────────────────
PORT="${PORT:-8000}"

killed=false

# Try ss first (modern Linux)
if command -v ss &>/dev/null; then
    pids=$(ss -tlnp 2>/dev/null | grep ":${PORT}\b" | grep -oP 'pid=\K[0-9]+' | sort -u)
    for pid in $pids; do
        kill "$pid" 2>/dev/null && killed=true
    done
fi

# Try lsof as fallback (macOS, older Linux)
if command -v lsof &>/dev/null; then
    lsof -ti ":$PORT" 2>/dev/null | while read -r pid; do
        kill "$pid" 2>/dev/null && killed=true
    done
fi

# Try pkill as last resort
if ! $killed; then
    pkill -f "python.*backend.py" 2>/dev/null && killed=true
fi

# ── Wait for graceful shutdown ───────────────────────────────────
sleep 1

# Force kill if still alive
if ss -tlnp 2>/dev/null | grep -q ":${PORT}\b" 2>/dev/null; then
    ss -tlnp 2>/dev/null | grep ":${PORT}\b" | grep -oP 'pid=\K[0-9]+' | sort -u | xargs -r kill -9 2>/dev/null
fi

if $killed; then
    echo "Server stopped"
else
    echo "Server was not running"
fi
