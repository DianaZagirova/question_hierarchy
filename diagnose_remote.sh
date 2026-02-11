#!/bin/bash
# Diagnostic script for remote server session issues

echo "=== OMEGA POINT SERVER DIAGNOSTICS ==="
echo ""

echo "1. Checking database schema for user_id column..."
docker compose exec -T postgres psql -U omegapoint -d omegapoint -c "\d sessions" | grep user_id
if [ $? -eq 0 ]; then
    echo "✓ user_id column exists"
else
    echo "✗ user_id column MISSING - this is the problem!"
fi
echo ""

echo "2. Checking deployed frontend version..."
docker exec omega-point ls -la /app/dist/assets/ | grep "index-.*\.js"
echo ""

echo "3. Checking recent application logs..."
docker compose logs --tail=30 omega-point | grep -E "(ERROR|Session|user_id|StateSync|resetToDefault)"
echo ""

echo "4. Testing session API..."
curl -c /tmp/test_cookie.txt -b /tmp/test_cookie.txt http://localhost:3002/api/session/validate 2>/dev/null | head -20
echo ""

echo "5. Checking database tables..."
docker compose exec -T postgres psql -U omegapoint -d omegapoint -c "\dt"
echo ""

echo "=== DIAGNOSIS COMPLETE ==="
echo ""
echo "Common issues and fixes:"
echo "- If user_id column is missing: Run the ALTER TABLE command"
echo "- If frontend is old: Run docker cp dist/. omega-point:/app/dist/"
echo "- If sessions aren't isolated: Check browser console for StateSync logs"
