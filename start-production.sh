#!/usr/bin/env bash
# ============================================================
# OMEGA-POINT — Production Start Script
# ============================================================
# Builds the React frontend and starts the Flask backend
# with gunicorn, serving everything on a single port.
#
# Usage:
#   chmod +x start-production.sh
#   ./start-production.sh
#
# Prerequisites:
#   - Node.js >= 18 and npm
#   - Python >= 3.10 and pip
#   - A valid .env file (copy from .env.production.example)
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Pre-flight checks ──────────────────────────────────────
info "Running pre-flight checks..."

command -v node  >/dev/null 2>&1 || error "Node.js is not installed"
command -v npm   >/dev/null 2>&1 || error "npm is not installed"
command -v python3 >/dev/null 2>&1 || error "Python 3 is not installed"

NODE_VER=$(node -v | sed 's/v//')
info "Node.js: v${NODE_VER}"
info "Python:  $(python3 --version)"

# ── Load .env ───────────────────────────────────────────────
if [ ! -f .env ]; then
  if [ -f .env.production.example ]; then
    warn ".env not found — copying from .env.production.example"
    cp .env.production.example .env
    warn "Please edit .env with your API keys, then re-run this script."
    exit 1
  else
    error ".env file not found. Copy .env.production.example to .env and configure it."
  fi
fi

# Source .env for this script (export all vars)
set -a
source .env
set +a

# Ensure NODE_ENV is production
export NODE_ENV=production

# Validate required vars
if [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${OPENROUTER_API_KEY:-}" ]; then
  error "No API key configured. Set OPENAI_API_KEY or OPENROUTER_API_KEY in .env"
fi

PORT="${PORT:-3001}"
HOST="${HOST:-0.0.0.0}"
GUNICORN_WORKERS="${GUNICORN_WORKERS:-4}"
GUNICORN_TIMEOUT="${GUNICORN_TIMEOUT:-300}"

ok "Environment loaded (provider: ${API_PROVIDER:-openai}, port: ${PORT})"

# ── Step 1: Install frontend dependencies ───────────────────
info "Installing frontend dependencies..."
npm ci --prefer-offline 2>/dev/null || npm install
ok "Frontend dependencies installed"

# ── Step 2: Build frontend ──────────────────────────────────
info "Building frontend (Vite production build)..."

# Set VITE_API_URL to empty so the frontend uses relative URLs
# (same origin as the Flask server in production)
export VITE_API_URL=""

npm run build
ok "Frontend built → dist/"

if [ ! -f dist/index.html ]; then
  error "Build failed — dist/index.html not found"
fi

# ── Step 3: Set up Python virtual environment ───────────────
info "Setting up Python environment..."

VENV_DIR="server/venv"
if [ ! -d "$VENV_DIR" ]; then
  info "Creating virtual environment..."
  python3 -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"
pip install -q --upgrade pip
pip install -q -r server/requirements.txt
ok "Python dependencies installed"

# ── Step 4: Start production server ─────────────────────────
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  OMEGA-POINT Production Server${NC}"
echo -e "${GREEN}============================================${NC}"
echo -e "  URL:      http://${HOST}:${PORT}"
echo -e "  Provider: ${API_PROVIDER:-openai}"
echo -e "  Workers:  ${GUNICORN_WORKERS}"
echo -e "  Timeout:  ${GUNICORN_TIMEOUT}s"
echo -e "${GREEN}============================================${NC}"
echo ""

exec gunicorn \
  --chdir server \
  --bind "${HOST}:${PORT}" \
  --workers "${GUNICORN_WORKERS}" \
  --timeout "${GUNICORN_TIMEOUT}" \
  --access-logfile - \
  --error-logfile - \
  --log-level info \
  app:app
