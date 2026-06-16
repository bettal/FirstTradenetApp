#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

if [ ! -d .venv ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

if ! .venv/bin/pip show -q psycopg2-binary 2>/dev/null; then
    echo "Installing dependencies..."
    .venv/bin/pip install -r requirements.txt
fi

echo "Starting server on http://localhost:8000"
.venv/bin/python3 backend.py
