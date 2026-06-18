#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Load env overrides if present
if [ -f .env ]; then
    set -a; source .env; set +a
fi

# ── PostgreSQL check ──────────────────────────────────────────────
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-tradernet}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"

echo "Checking PostgreSQL..."
if command -v pg_isready &>/dev/null; then
    if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -q 2>/dev/null; then
        echo "ERROR: PostgreSQL is not running on ${DB_HOST}:${DB_PORT}"
        echo "       Start it with: sudo systemctl start postgresql"
        exit 1
    fi
else
    echo "WARNING: pg_isready not found, skipping PostgreSQL check"
fi

# Ensure database and role exist
echo "Ensuring database '$DB_NAME' exists..."
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -tc \
    "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null | grep -q 1 || \
    PGPASSWORD="$DB_PASSWORD" createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" 2>/dev/null || \
    echo "WARNING: Could not create database '$DB_NAME' (may need manual setup)"

# ── SSL certs ────────────────────────────────────────────────────
if [ ! -f certs/cert.pem ] || [ ! -f certs/key.pem ]; then
    echo "Generating self-signed SSL certificate..."
    mkdir -p certs
    openssl req -x509 -newkey rsa:4096 \
        -keyout certs/key.pem -out certs/cert.pem \
        -days 365 -nodes -subj "/CN=localhost"
    echo "Certificate generated in certs/"
fi

# ── Python virtual environment ───────────────────────────────────
if [ ! -d .venv ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

if ! .venv/bin/pip show -q psycopg2-binary 2>/dev/null; then
    echo "Installing Python dependencies..."
    .venv/bin/pip install -r requirements.txt
fi

# ── Node dependencies ─────────────────────────────────────────────
if [ ! -d frontend/node_modules ]; then
    echo "Installing frontend dependencies..."
    npm install --prefix frontend
fi

# ── Port check ───────────────────────────────────────────────────
PORT="${PORT:-8000}"
if command -v ss &>/dev/null; then
    if ss -tlnp 2>/dev/null | grep -q ":${PORT}\b"; then
        echo "Port $PORT in use. Killing existing server..."
        pkill -f "python.*backend.py" 2>/dev/null || true
        sleep 1
    fi
    if ss -tlnp 2>/dev/null | grep -q ":5173\b"; then
        echo "Port 5173 in use. Killing existing Vite..."
        pkill -f "node.*vite" 2>/dev/null || true
        sleep 1
    fi
fi

# ── Start services ─────────────────────────────────────────────────
echo ""
echo "Starting HTTPS backend on https://localhost:${PORT} ..."
.venv/bin/python3 backend.py &
BACKEND_PID=$!

echo "Starting HTTPS Vite dev server on https://localhost:5173 ..."
npm start --prefix frontend &
FRONTEND_PID=$!

cleanup() {
    echo ""
    echo "Shutting down..."
    kill "$BACKEND_PID" 2>/dev/null || true
    kill "$FRONTEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
    echo "Done."
}
trap cleanup EXIT INT TERM

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Backend API:  https://localhost:${PORT}"
echo "  Frontend:     https://localhost:5173"
echo "  Press Ctrl+C to stop both services"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

wait
