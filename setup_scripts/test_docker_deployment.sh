#!/bin/bash

# Docker Deployment Test Script for Omega Point
# Tests complete deployment including session management

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
API_URL="http://localhost:3002"
WAIT_TIMEOUT=120

echo "═══════════════════════════════════════════════════════════"
echo "  OMEGA POINT - Docker Deployment Test"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check prerequisites
echo "Checking prerequisites..."
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker not found${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}✗ docker-compose not found${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Prerequisites met${NC}"
echo ""

# Check if .env exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠ No .env file found${NC}"
    echo "Creating .env from .env.production.example..."
    cp .env.production.example .env
    echo -e "${YELLOW}⚠ Please edit .env and set OPENAI_API_KEY before production use${NC}"
    echo ""
fi

# Stop existing containers
echo "Stopping existing containers..."
docker-compose down > /dev/null 2>&1 || true
echo ""

# Build and start
echo "Building and starting services..."
echo -e "${BLUE}This may take a few minutes...${NC}"
if docker-compose up --build -d; then
    echo -e "${GREEN}✓ Services started${NC}"
else
    echo -e "${RED}✗ Failed to start services${NC}"
    exit 1
fi
echo ""

# Wait for services to be healthy
echo "Waiting for services to be healthy..."
ELAPSED=0
while [ $ELAPSED -lt $WAIT_TIMEOUT ]; do
    POSTGRES_HEALTHY=$(docker inspect omega-point-postgres --format='{{.State.Health.Status}}' 2>/dev/null || echo "starting")
    REDIS_HEALTHY=$(docker inspect omega-point-redis --format='{{.State.Health.Status}}' 2>/dev/null || echo "starting")
    APP_RUNNING=$(docker inspect omega-point --format='{{.State.Running}}' 2>/dev/null || echo "false")

    if [ "$POSTGRES_HEALTHY" = "healthy" ] && [ "$REDIS_HEALTHY" = "healthy" ] && [ "$APP_RUNNING" = "true" ]; then
        echo -e "${GREEN}✓ All services healthy${NC}"
        break
    fi

    echo -ne "\r⏳ Waiting... ${ELAPSED}s (PostgreSQL: $POSTGRES_HEALTHY, Redis: $REDIS_HEALTHY, App: $APP_RUNNING)"
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

if [ $ELAPSED -ge $WAIT_TIMEOUT ]; then
    echo -e "\n${RED}✗ Timeout waiting for services${NC}"
    echo "Check logs:"
    echo "  docker-compose logs postgres"
    echo "  docker-compose logs redis"
    echo "  docker-compose logs omega-point"
    exit 1
fi

echo ""

# Wait for application to be ready
echo "Waiting for application to be ready..."
ELAPSED=0
while [ $ELAPSED -lt 60 ]; do
    if curl -s -f "$API_URL/api/session/validate" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Application responding${NC}"
        break
    fi
    echo -ne "\r⏳ Waiting... ${ELAPSED}s"
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

if [ $ELAPSED -ge 60 ]; then
    echo -e "\n${RED}✗ Application not responding${NC}"
    echo "Checking logs..."
    docker-compose logs --tail=50 omega-point
    exit 1
fi

echo ""

# Run health check
echo "Running health check..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
./health_check.sh
HEALTH_EXIT=$?

if [ $HEALTH_EXIT -eq 0 ]; then
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✅ Docker Deployment Test PASSED${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Access the application at:"
    echo -e "  ${BLUE}${API_URL}${NC}"
    echo ""
    echo "View logs:"
    echo "  docker-compose logs -f"
    echo ""
    echo "Stop services:"
    echo "  docker-compose down"
    echo ""
else
    echo ""
    echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${RED}  ❌ Docker Deployment Test FAILED${NC}"
    echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Check logs for errors:"
    echo "  docker-compose logs omega-point"
    echo "  docker-compose logs postgres"
    echo "  docker-compose logs redis"
    echo ""
    exit 1
fi
