#!/usr/bin/env bash
# ============================================================
# OMEGA-POINT — Development Start Script
# ============================================================
# Starts both the Vite dev server (frontend) and the Flask
# backend in parallel. Ctrl+C stops both.
#
# Usage:
#   chmod +x start-dev.sh
#   ./start-dev.sh
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Load .env ───────────────────────────────────────────────
if [ -f .env ]; then
  set -a; source .env; set +a
fi
export NODE_ENV=development

# ── Python venv ─────────────────────────────────────────────
VENV_DIR="server/venv"
if [ ! -d "$VENV_DIR" ]; then
  info "Creating Python virtual environment..."
  python3 -m venv "$VENV_DIR"
  source "$VENV_DIR/bin/activate"
  pip install -q -r server/requirements.txt
  ok "Python environment ready"
else
  source "$VENV_DIR/bin/activate"
fi

# ── npm deps ────────────────────────────────────────────────
if [ ! -d node_modules ]; then
  info "Installing npm dependencies..."
  npm install
fi

# ── Start both servers ──────────────────────────────────────
info "Starting development servers..."
echo -e "  Frontend: ${GREEN}http://localhost:5173${NC}"
echo -e "  Backend:  ${GREEN}http://localhost:${PORT:-3001}${NC}"
echo ""

cleanup() {
  echo ""
  info "Shutting down..."
  kill 0 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

# Start Flask backend
(cd server && python3 app.py) &
BACKEND_PID=$!

# Start Vite frontend
npx vite &
FRONTEND_PID=$!

wait
