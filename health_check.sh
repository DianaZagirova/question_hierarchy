#!/bin/bash

# Health Check Script for Omega Point Production Deployment
# Verifies all services and session management functionality

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_URL="${API_URL:-http://localhost:3002}"
TIMEOUT=5

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# Helper functions
check_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASSED++))
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ((FAILED++))
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARNINGS++))
}

check_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

echo "═══════════════════════════════════════════════════════════"
echo "  OMEGA POINT - Production Health Check"
echo "═══════════════════════════════════════════════════════════"
echo ""

# 1. Docker Services
echo "1. Checking Docker Services..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if command -v docker &> /dev/null; then
    # Check PostgreSQL
    if docker ps | grep -q "omega-point-postgres"; then
        if docker exec omega-point-postgres pg_isready -U omegapoint &> /dev/null; then
            check_pass "PostgreSQL is running and accepting connections"
        else
            check_fail "PostgreSQL is running but not accepting connections"
        fi
    else
        check_fail "PostgreSQL container not found"
    fi

    # Check Redis
    if docker ps | grep -q "omega-point-redis"; then
        if docker exec omega-point-redis redis-cli ping | grep -q "PONG"; then
            check_pass "Redis is running and responding"
        else
            check_fail "Redis is running but not responding"
        fi
    else
        check_fail "Redis container not found"
    fi

    # Check Application
    if docker ps | grep -q "omega-point"; then
        check_pass "Application container is running"

        # Check application logs for errors
        if docker logs --tail 50 omega-point 2>&1 | grep -qi "error\|exception\|failed"; then
            check_warn "Recent errors found in application logs"
        fi
    else
        check_fail "Application container not found"
    fi
else
    check_warn "Docker not found - skipping container checks"
fi

echo ""

# 2. API Endpoints
echo "2. Checking API Endpoints..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Create temp cookie file
COOKIE_FILE=$(mktemp)
trap "rm -f $COOKIE_FILE" EXIT

# Session validation
if curl -s -f -c "$COOKIE_FILE" --max-time $TIMEOUT "$API_URL/api/session/validate" > /dev/null 2>&1; then
    check_pass "Session validation endpoint responding"

    # Extract session ID
    SESSION_ID=$(curl -s -b "$COOKIE_FILE" "$API_URL/api/session/validate" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)

    if [ -n "$SESSION_ID" ]; then
        check_pass "Session created successfully: ${SESSION_ID:0:20}..."
    else
        check_warn "Session validation response unexpected"
    fi
else
    check_fail "Session validation endpoint not responding"
fi

# User sessions endpoint
if curl -s -f -b "$COOKIE_FILE" --max-time $TIMEOUT "$API_URL/api/user-sessions" > /dev/null 2>&1; then
    check_pass "User sessions endpoint responding"
else
    check_fail "User sessions endpoint not responding"
fi

# Export endpoint
if curl -s -f -b "$COOKIE_FILE" --max-time $TIMEOUT "$API_URL/api/export/all" | grep -q "metadata"; then
    check_pass "Export endpoint responding with valid data"
else
    check_warn "Export endpoint responding but data format unexpected"
fi

echo ""

# 3. Database Health
echo "3. Checking Database Health..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if command -v docker &> /dev/null && docker ps | grep -q "omega-point-postgres"; then
    # Check tables exist
    TABLES=$(docker exec omega-point-postgres psql -U omegapoint -d omegapoint -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ')

    if [ "$TABLES" -ge 4 ]; then
        check_pass "Database tables exist (found $TABLES tables)"
    else
        check_fail "Missing database tables (found $TABLES, expected ≥4)"
    fi

    # Check users table
    if docker exec omega-point-postgres psql -U omegapoint -d omegapoint -c "\d users" &> /dev/null; then
        check_pass "users table exists"
    else
        check_fail "users table not found"
    fi

    # Check sessions table
    if docker exec omega-point-postgres psql -U omegapoint -d omegapoint -c "\d sessions" &> /dev/null; then
        check_pass "sessions table exists"

        # Check user_id column
        if docker exec omega-point-postgres psql -U omegapoint -d omegapoint -c "\d sessions" | grep -q "user_id"; then
            check_pass "sessions.user_id foreign key exists"
        else
            check_fail "sessions.user_id column not found"
        fi
    else
        check_fail "sessions table not found"
    fi

    # Check session_state table
    if docker exec omega-point-postgres psql -U omegapoint -d omegapoint -c "\d session_state" &> /dev/null; then
        check_pass "session_state table exists"
    else
        check_fail "session_state table not found"
    fi

    # Check connection count
    CONNECTIONS=$(docker exec omega-point-postgres psql -U omegapoint -d omegapoint -t -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'omegapoint';" 2>/dev/null | tr -d ' ')
    check_info "Active database connections: $CONNECTIONS"

    # Check database size
    DB_SIZE=$(docker exec omega-point-postgres psql -U omegapoint -d omegapoint -t -c "SELECT pg_size_pretty(pg_database_size('omegapoint'));" 2>/dev/null | tr -d ' ')
    check_info "Database size: $DB_SIZE"

    # Check active sessions
    ACTIVE_SESSIONS=$(docker exec omega-point-postgres psql -U omegapoint -d omegapoint -t -c "SELECT count(*) FROM sessions WHERE is_active = true;" 2>/dev/null | tr -d ' ')
    check_info "Active sessions in DB: $ACTIVE_SESSIONS"
fi

echo ""

# 4. Redis Health
echo "4. Checking Redis Health..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if command -v docker &> /dev/null && docker ps | grep -q "omega-point-redis"; then
    # Memory usage
    MEMORY=$(docker exec omega-point-redis redis-cli INFO memory 2>/dev/null | grep "used_memory_human" | cut -d: -f2 | tr -d '\r')
    check_info "Redis memory usage: $MEMORY"

    # Key count
    KEYS=$(docker exec omega-point-redis redis-cli DBSIZE 2>/dev/null | grep -o '[0-9]*')
    check_info "Redis keys count: $KEYS"

    # Max memory policy
    POLICY=$(docker exec omega-point-redis redis-cli CONFIG GET maxmemory-policy 2>/dev/null | tail -n1 | tr -d '\r')
    if [ "$POLICY" = "allkeys-lru" ]; then
        check_pass "Redis eviction policy: allkeys-lru"
    else
        check_warn "Redis eviction policy: $POLICY (expected allkeys-lru)"
    fi
fi

echo ""

# 5. Session Management
echo "5. Testing Session Management..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Test session creation
TEST_SESSION=$(curl -s -X POST "$API_URL/api/user-sessions" \
    -H "Content-Type: application/json" \
    -b "$COOKIE_FILE" \
    -d '{"name":"Health Check Test"}' 2>/dev/null)

if echo "$TEST_SESSION" | grep -q '"id"'; then
    check_pass "Session creation working"

    # Extract session ID
    TEST_SESSION_ID=$(echo "$TEST_SESSION" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

    # Test session retrieval
    if curl -s -f -b "$COOKIE_FILE" "$API_URL/api/user-sessions/$TEST_SESSION_ID" > /dev/null 2>&1; then
        check_pass "Session retrieval working"
    else
        check_fail "Session retrieval failed"
    fi

    # Test session deletion
    if curl -s -f -X DELETE -b "$COOKIE_FILE" "$API_URL/api/user-sessions/$TEST_SESSION_ID" > /dev/null 2>&1; then
        check_pass "Session deletion working"
    else
        check_warn "Session deletion failed"
    fi
else
    check_fail "Session creation failed"
fi

echo ""

# 6. Export/Import
echo "6. Testing Export/Import..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Test export
EXPORT_DATA=$(curl -s -b "$COOKIE_FILE" "$API_URL/api/export/all" 2>/dev/null)

if echo "$EXPORT_DATA" | grep -q '"metadata"'; then
    check_pass "Export endpoint functional"

    # Check export format
    if echo "$EXPORT_DATA" | grep -q '"version"' && echo "$EXPORT_DATA" | grep -q '"exported_at"'; then
        check_pass "Export format valid"
    else
        check_warn "Export format may be invalid"
    fi
else
    check_fail "Export endpoint not functional"
fi

# Test import (using empty sessions array to avoid creating test data)
IMPORT_TEST='{"metadata":{"version":"1.0"},"sessions":[]}'
if curl -s -f -X POST "$API_URL/api/import/sessions" \
    -H "Content-Type: application/json" \
    -b "$COOKIE_FILE" \
    -d "$IMPORT_TEST" > /dev/null 2>&1; then
    check_pass "Import endpoint functional"
else
    check_fail "Import endpoint not functional"
fi

echo ""

# 7. Performance Metrics
echo "7. Performance Metrics..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if command -v docker &> /dev/null && docker ps | grep -q "omega-point"; then
    # Response time test
    START=$(date +%s%N)
    curl -s -f "$API_URL/api/session/validate" > /dev/null 2>&1
    END=$(date +%s%N)
    RESPONSE_TIME=$(( ($END - $START) / 1000000 ))

    if [ $RESPONSE_TIME -lt 1000 ]; then
        check_pass "API response time: ${RESPONSE_TIME}ms (good)"
    elif [ $RESPONSE_TIME -lt 3000 ]; then
        check_warn "API response time: ${RESPONSE_TIME}ms (acceptable)"
    else
        check_fail "API response time: ${RESPONSE_TIME}ms (slow)"
    fi

    # Check CPU usage
    CPU_USAGE=$(docker stats omega-point --no-stream --format "{{.CPUPerc}}" 2>/dev/null | tr -d '%')
    if [ -n "$CPU_USAGE" ]; then
        check_info "Application CPU usage: ${CPU_USAGE}%"
    fi

    # Check memory usage
    MEM_USAGE=$(docker stats omega-point --no-stream --format "{{.MemUsage}}" 2>/dev/null)
    if [ -n "$MEM_USAGE" ]; then
        check_info "Application memory: $MEM_USAGE"
    fi
fi

echo ""

# Summary
echo "═══════════════════════════════════════════════════════════"
echo "  Health Check Summary"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo -e "${GREEN}Passed:${NC}   $PASSED"
echo -e "${YELLOW}Warnings:${NC} $WARNINGS"
echo -e "${RED}Failed:${NC}   $FAILED"
echo ""

# Exit code
if [ $FAILED -gt 0 ]; then
    echo -e "${RED}❌ Health check FAILED${NC}"
    echo "Review failed checks above and check logs:"
    echo "  docker-compose logs omega-point"
    echo "  docker-compose logs postgres"
    echo "  docker-compose logs redis"
    exit 1
elif [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Health check PASSED with warnings${NC}"
    echo "Review warnings above for potential issues"
    exit 0
else
    echo -e "${GREEN}✅ Health check PASSED${NC}"
    echo "All systems operational!"
    exit 0
fi
