#!/bin/bash
# Quick Fix Script for Critical Security Issues
# Run this BEFORE deploying to production

set -e

echo "========================================"
echo "  Critical Security Issues Fix Script  "
echo "========================================"
echo ""

# Check if running in correct directory
if [ ! -f "server/app.py" ]; then
    echo "❌ Error: Must run from project root directory"
    exit 1
fi

echo "Step 1: Remove .env files from git tracking"
echo "-------------------------------------------"
git rm --cached .env .env.dev 2>/dev/null || echo "  (Files not tracked)"

# Add to .gitignore
if ! grep -q "^\.env$" .gitignore 2>/dev/null; then
    echo ".env" >> .gitignore
    echo ".env.*" >> .gitignore
    echo "!.env.example" >> .gitignore
    echo "  ✓ Added .env to .gitignore"
fi

echo ""
echo "Step 2: Create .env.example template"
echo "-------------------------------------"
if [ -f ".env" ]; then
    cat > .env.example << 'EOF'
# OpenRouter API Configuration
OPENROUTER_API_KEY=sk-or-v1-your-key-here
API_PROVIDER=openrouter

# OpenAI API Configuration (alternative)
OPENAI_API_KEY=sk-proj-your-key-here

# Database Configuration
DATABASE_URL=postgresql://username:password@host:5432/dbname
DB_PASSWORD=your-secure-password-here

# Redis Configuration
REDIS_URL=redis://redis:6379/0

# Application Configuration
PORT=3002
NODE_ENV=production

# Session Security
SESSION_SECRET=generate-a-random-64-character-string-here

# CORS Configuration
ALLOWED_ORIGINS=https://yourdomain.com,http://localhost:3002
EOF
    echo "  ✓ Created .env.example"
fi

echo ""
echo "Step 3: Backup and update server/app.py"
echo "----------------------------------------"
cp server/app.py server/app.py.backup
echo "  ✓ Backup created: server/app.py.backup"

# Fix CORS
echo ""
echo "Step 4: Fix CORS configuration"
echo "-------------------------------"
echo "  Manual fix required: Update line 63 in server/app.py"
echo "  Change: CORS(app)"
echo "  To: CORS(app, resources={r'/api/*': {'origins': ['https://yourdomain.com']}})"

echo ""
echo "Step 5: Add rate limiting"
echo "-------------------------"
echo "  Manual steps:"
echo "  1. Add to requirements.txt: Flask-Limiter==3.5.0"
echo "  2. Run: pip install Flask-Limiter"
echo "  3. Add to app.py after Flask app creation:"
echo ""
echo "     from flask_limiter import Limiter"
echo "     limiter = Limiter(app=app, key_func=get_remote_address)"
echo ""

echo ""
echo "Step 6: Generate strong session secret"
echo "---------------------------------------"
NEW_SECRET=$(openssl rand -hex 32)
echo "  Generated secret (add to .env):"
echo "  SESSION_SECRET=$NEW_SECRET"
echo ""

echo ""
echo "Step 7: Commit security fixes"
echo "------------------------------"
git add .gitignore .env.example 2>/dev/null || true
echo "  Files staged for commit"
echo ""

echo "========================================"
echo "  CRITICAL MANUAL STEPS REQUIRED       "
echo "========================================"
echo ""
echo "1. ⚠️  REVOKE EXPOSED API KEYS:"
echo "   - OpenRouter: https://openrouter.ai/keys"
echo "   - OpenAI: https://platform.openai.com/api-keys"
echo ""
echo "2. ⚠️  GENERATE NEW API KEYS:"
echo "   - Get new keys from both services"
echo "   - Add to .env (DO NOT commit .env!)"
echo ""
echo "3. ⚠️  REMOVE .ENV FROM GIT HISTORY:"
echo "   git filter-branch --force --index-filter \\"
echo "     'git rm --cached --ignore-unmatch .env .env.dev' \\"
echo "     --prune-empty --tag-name-filter cat -- --all"
echo "   git push origin --force --all"
echo ""
echo "4. ⚠️  UPDATE CORS IN server/app.py:"
echo "   See Step 4 output above"
echo ""
echo "5. ⚠️  ADD RATE LIMITING:"
echo "   See Step 5 output above"
echo ""
echo "6. ⚠️  SET PRODUCTION ENVIRONMENT VARIABLES:"
echo "   - Copy .env.example to .env"
echo "   - Fill in real values"
echo "   - Set NODE_ENV=production"
echo ""
echo "7. ✅  COMMIT CHANGES:"
echo "   git add ."
echo "   git commit -m 'Security: Fix critical issues before production'"
echo "   git push origin main"
echo ""
echo "========================================"
echo "  Next: Review PRODUCTION_READINESS_REPORT.md"
echo "========================================"
