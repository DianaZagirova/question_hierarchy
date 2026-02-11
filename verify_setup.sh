#!/bin/bash

# Verification script for Omega Point session management
# Checks that export/import and user binding are correctly set up

echo "═══════════════════════════════════════════════════════════"
echo "  OMEGA POINT - Session Management Verification"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check functions
check_pass() {
    echo -e "${GREEN}✓${NC} $1"
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

check_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# 1. Check database schema
echo "1. Checking Database Schema..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if command -v psql &> /dev/null; then
    # Check users table
    if psql -U omegapoint -d omegapoint -c "\d users" &> /dev/null; then
        check_pass "users table exists"
    else
        check_fail "users table NOT found"
        check_info "Run: psql -U omegapoint -d omegapoint -f server/init.sql"
    fi

    # Check sessions table user_id column
    if psql -U omegapoint -d omegapoint -c "\d sessions" | grep -q "user_id"; then
        check_pass "sessions.user_id column exists"
    else
        check_fail "sessions.user_id column NOT found"
    fi

    # Check session_state table
    if psql -U omegapoint -d omegapoint -c "\d session_state" &> /dev/null; then
        check_pass "session_state table exists"
    else
        check_fail "session_state table NOT found"
    fi
else
    check_warn "psql not found - skipping database checks"
    check_info "Install PostgreSQL client or run manually"
fi

echo ""

# 2. Check backend files
echo "2. Checking Backend Files..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check database.py for User model
if grep -q "class User(Base):" server/database.py; then
    check_pass "User model exists in database.py"
else
    check_fail "User model NOT found in database.py"
fi

# Check app.py for export endpoints
if grep -q "/api/export/all" server/app.py; then
    check_pass "Export endpoints exist in app.py"
else
    check_fail "Export endpoints NOT found in app.py"
fi

# Check app.py for import endpoints
if grep -q "/api/import/sessions" server/app.py; then
    check_pass "Import endpoints exist in app.py"
else
    check_fail "Import endpoints NOT found in app.py"
fi

echo ""

# 3. Check frontend files
echo "3. Checking Frontend Files..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check sessionApi.ts for export/import functions
if grep -q "exportAllSessions" src/lib/sessionApi.ts; then
    check_pass "Export functions exist in sessionApi.ts"
else
    check_fail "Export functions NOT found in sessionApi.ts"
fi

if grep -q "importSessions" src/lib/sessionApi.ts; then
    check_pass "Import functions exist in sessionApi.ts"
else
    check_fail "Import functions NOT found in sessionApi.ts"
fi

# Check SessionSwitcher for export/import UI
if grep -q "handleExport" src/components/SessionSwitcher.tsx; then
    check_pass "Export UI exists in SessionSwitcher"
else
    check_fail "Export UI NOT found in SessionSwitcher"
fi

# Check SessionExportImport component
if [ -f "src/components/SessionExportImport.tsx" ]; then
    check_pass "SessionExportImport component exists"
else
    check_warn "SessionExportImport component NOT found (optional)"
fi

echo ""

# 4. Check documentation
echo "4. Checking Documentation..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f "SESSION_MIGRATION.md" ]; then
    check_pass "SESSION_MIGRATION.md exists"
else
    check_warn "SESSION_MIGRATION.md NOT found"
fi

if [ -f "TEST_EXPORT_IMPORT.md" ]; then
    check_pass "TEST_EXPORT_IMPORT.md exists"
else
    check_warn "TEST_EXPORT_IMPORT.md NOT found"
fi

echo ""

# 5. Test API endpoints (if server is running)
echo "5. Testing API Endpoints..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if curl -s http://localhost:5001/api/session/validate > /dev/null 2>&1; then
    check_pass "Server is running on port 5001"

    # Test export endpoint (requires session)
    if curl -s -c /tmp/test_cookies.txt http://localhost:5001/api/session/validate > /dev/null 2>&1; then
        if curl -s -b /tmp/test_cookies.txt http://localhost:5001/api/export/all | grep -q "metadata"; then
            check_pass "Export API endpoint works"
        else
            check_warn "Export API endpoint returned unexpected response"
        fi
        rm -f /tmp/test_cookies.txt
    fi
else
    check_warn "Server not running - skipping API tests"
    check_info "Start server with: python server/app.py"
fi

echo ""

# Summary
echo "═══════════════════════════════════════════════════════════"
echo "  Verification Complete"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Start server: python server/app.py"
echo "  2. Start frontend: npm run dev"
echo "  3. Open browser: http://localhost:5173"
echo "  4. Test export/import in session switcher dropdown"
echo "  5. See TEST_EXPORT_IMPORT.md for detailed testing"
echo ""
