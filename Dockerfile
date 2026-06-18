# Stage 1: Build React SPA
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 2: Python backend with built SPA
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend.py config.py trade_manager.py ./
COPY --from=frontend-builder /app/static ./static
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

RUN mkdir -p logs

EXPOSE 8000
CMD ["./entrypoint.sh"]
