#!/bin/bash
# Quick start script for development Docker deployment with hot-reload

set -e

echo "🐳 Omega Point - Development Docker Setup"
echo "========================================="
echo ""

# Check if .env.dev exists
if [ ! -f .env.dev ]; then
    echo "📝 Creating .env.dev from template..."
    cp .env.example .env.dev

    # Update for dev environment
    sed -i 's/NODE_ENV=development/NODE_ENV=development/g' .env.dev
    sed -i 's/PORT=3002/PORT=3003/g' .env.dev
    sed -i 's/@postgres:5432/@postgres:5432/g' .env.dev

    echo "⚠️  IMPORTANT: Edit .env.dev and add your API keys!"
    echo ""
    echo "Required keys:"
    echo "  - OPENROUTER_API_KEY (get from https://openrouter.ai/keys)"
    echo ""
    read -p "Press Enter after you've edited .env.dev with your keys..."
fi

# Verify OPENROUTER_API_KEY is set
if ! grep -q "OPENROUTER_API_KEY=sk-or-" .env.dev; then
    echo "❌ ERROR: OPENROUTER_API_KEY not set in .env.dev"
    echo "Get your key from: https://openrouter.ai/keys"
    exit 1
fi

echo "✅ Environment configured"
echo ""

# Build and start services
echo "🔨 Building Docker images..."
docker compose -f docker-compose.dev.yml build

echo ""
echo "🚀 Starting development services with hot-reload..."
docker compose -f docker-compose.dev.yml up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Wait for health checks
echo "Checking PostgreSQL..."
until docker compose -f docker-compose.dev.yml exec postgres pg_isready -U omegapoint > /dev/null 2>&1; do
    echo "  Waiting for PostgreSQL..."
    sleep 2
done
echo "✅ PostgreSQL ready"

echo "Checking Redis..."
until docker compose -f docker-compose.dev.yml exec redis redis-cli ping > /dev/null 2>&1; do
    echo "  Waiting for Redis..."
    sleep 2
done
echo "✅ Redis ready"

echo ""
echo "📊 Service Status:"
docker compose -f docker-compose.dev.yml ps

echo ""
echo "🔍 Checking Step 4 initialization..."
sleep 5
docker compose -f docker-compose.dev.yml logs backend | grep "Step4" || echo "⚠️  Step 4 logs not found yet"

echo ""
echo "✅ Development environment ready!"
echo ""
echo "🌐 Services running at:"
echo "  Frontend (Vite):  http://localhost:5173"
echo "  Backend (Flask):  http://localhost:3003"
echo "  PostgreSQL:       localhost:5433"
echo "  Redis:            localhost:6380"
echo ""
echo "🔥 Hot-reload enabled:"
echo "  - Frontend: Changes to src/* auto-reload"
echo "  - Backend: Changes to server/*.py auto-reload"
echo "  - Step 4 modules: Mounted and auto-reload"
echo ""
echo "📝 Useful commands:"
echo "  View logs:        docker compose -f docker-compose.dev.yml logs -f"
echo "  Stop services:    docker compose -f docker-compose.dev.yml down"
echo "  Restart backend:  docker compose -f docker-compose.dev.yml restart backend"
echo "  Run tests:        docker compose -f docker-compose.dev.yml exec backend python /app/server/test_step4_optimized.py"
echo ""
echo "📚 See DOCKER_STEP4_GUIDE.md for more information"
