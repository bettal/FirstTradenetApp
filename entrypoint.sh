#!/bin/bash
set -e

# Generate self-signed SSL certificate if not present
if [ ! -f certs/cert.pem ]; then
    echo "Generating self-signed SSL certificate..."
    mkdir -p certs
    openssl req -x509 -newkey rsa:4096 \
        -keyout certs/key.pem -out certs/cert.pem \
        -days 365 -nodes -subj "/CN=localhost"
fi

# Wait for PostgreSQL
echo "Waiting for PostgreSQL at ${DB_HOST:-postgres}:${DB_PORT:-5432}..."
until pg_isready -h "${DB_HOST:-postgres}" -p "${DB_PORT:-5432}" -U "${DB_USER:-postgres}" -q; do
    sleep 1
done
echo "PostgreSQL is ready"

exec python3 backend.py
