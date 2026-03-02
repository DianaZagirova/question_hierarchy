# ============================================================
# OMEGA-POINT — Multi-stage Docker Build
# ============================================================
# Stage 1: Build the React/Vite frontend
# Stage 2: Run the Flask/Gunicorn backend serving the built frontend
# ============================================================

# ── Stage 1: Frontend build ──────────────────────────────────
FROM node:20-alpine AS frontend

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --prefer-offline 2>/dev/null || npm install

# Copy source and build
COPY . .
ENV VITE_API_URL=""
RUN npm run build

# ── Stage 2: Production server ───────────────────────────────
FROM python:3.11-slim AS production

WORKDIR /app

# Install system dependencies for ML packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY server/requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir -r /app/server/requirements.txt

# Copy server code
COPY server/*.py /app/server/
COPY server/init.sql /app/server/init.sql

# Copy Step 4 optimized modules
COPY server/research_apis_optimized.py /app/server/
COPY server/knowledge_dedup_optimized.py /app/server/
COPY server/knowledge_cache_optimized.py /app/server/
COPY server/step4_pipeline_optimized.py /app/server/
COPY server/step4_integration.py /app/server/

# Copy migrations
COPY server/migrations /app/server/migrations

# Copy built frontend from Stage 1
COPY --from=frontend /app/dist /app/dist
COPY src/config/agents.ts /app/src/config/agents.ts
COPY src/config/agents_neutral.ts /app/src/config/agents_neutral.ts

# Environment defaults (override via docker-compose or docker run -e)
ENV PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    PORT=3002 \
    HOST=0.0.0.0 \
    GUNICORN_WORKERS=2 \
    GUNICORN_TIMEOUT=420 \
    API_PROVIDER=openai

EXPOSE 3002

CMD gunicorn \
    --chdir server \
    --bind "${HOST}:${PORT}" \
    --workers "${GUNICORN_WORKERS}" \
    --timeout "${GUNICORN_TIMEOUT}" \
    --access-logfile - \
    --error-logfile - \
    --capture-output \
    --enable-stdio-inheritance \
    --log-level info \
    app:app
