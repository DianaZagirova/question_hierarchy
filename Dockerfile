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

# Install Python dependencies
COPY server/requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir -r /app/server/requirements.txt

# Copy server code
COPY server/app.py /app/server/app.py

# Copy built frontend from Stage 1
COPY --from=frontend /app/dist /app/dist

# Environment defaults (override via docker-compose or docker run -e)
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    GUNICORN_WORKERS=4 \
    GUNICORN_TIMEOUT=300 \
    API_PROVIDER=openai

EXPOSE 3001

CMD gunicorn \
    --chdir server \
    --bind "${HOST}:${PORT}" \
    --workers "${GUNICORN_WORKERS}" \
    --timeout "${GUNICORN_TIMEOUT}" \
    --access-logfile - \
    --error-logfile - \
    --log-level info \
    app:app
