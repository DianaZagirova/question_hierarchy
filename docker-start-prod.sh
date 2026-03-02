#!/bin/bash
# Quick start script for production Docker deployment

set -e

echo "🐳 Omega Point - Production Docker Setup"
echo "========================================"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env from template..."
    cp .env.production.example .env
    echo "⚠️  IMPORTANT: Edit .env and add your API keys!"
    echo ""
    echo "Required keys:"
    echo "  - OPENROUTER_API_KEY (get from https://openrouter.ai/keys)"
    echo ""
    echo "Optional keys (improves rate limits):"
    echo "  - PUBMED_API_KEY"
    echo "  - SEMANTIC_SCHOLAR_API_KEY"
    echo ""
    read -p "Press Enter after you've edited .env with your keys..."
fi

# Verify OPENROUTER_API_KEY is set
if ! grep -q "OPENROUTER_API_KEY=sk-or-" .env; then
    echo "❌ ERROR: OPENROUTER_API_KEY not set in .env"
    echo "Get your key from: https://openrouter.ai/keys"
    exit 1
fi

echo "✅ Environment configured"
echo ""

# Build and start services
echo "🔨 Building Docker images (this may take 5-10 minutes)..."
docker compose build

echo ""
echo "🚀 Starting services..."
docker compose up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Wait for health checks
echo "Checking PostgreSQL..."
until docker compose exec postgres pg_isready -U omegapoint > /dev/null 2>&1; do
    echo "  Waiting for PostgreSQL..."
    sleep 2
done
echo "✅ PostgreSQL ready"

echo "Checking Redis..."
until docker compose exec redis redis-cli ping > /dev/null 2>&1; do
    echo "  Waiting for Redis..."
    sleep 2
done
echo "✅ Redis ready"

echo ""
echo "📊 Service Status:"
docker compose ps

echo ""
echo "🔍 Checking Step 4 initialization..."
sleep 5
docker compose logs omega-point | grep "Step4" || echo "⚠️  Step 4 logs not found yet (may still be starting)"

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Application running at: http://localhost:3002"
echo ""
echo "📝 Useful commands:"
echo "  View logs:        docker compose logs -f"
echo "  Stop services:    docker compose down"
echo "  Restart:          docker compose restart"
echo "  Run tests:        docker compose exec omega-point python /app/server/test_step4_optimized.py"
echo ""
echo "📚 See DOCKER_STEP4_GUIDE.md for more information"
