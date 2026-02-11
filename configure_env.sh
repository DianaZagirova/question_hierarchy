#!/bin/bash

# Interactive .env Configuration Script for Omega Point
# Automatically generates secure passwords and configures environment

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "═══════════════════════════════════════════════════════════"
echo "  Omega Point - Environment Configuration Wizard"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check prerequisites
if ! command -v openssl &> /dev/null; then
    echo -e "${RED}✗ openssl not found${NC}"
    echo "  Install with: apt-get install openssl (Linux) or brew install openssl (macOS)"
    exit 1
fi

# Handle existing .env
if [ -f .env ]; then
    echo -e "${YELLOW}⚠ .env file already exists${NC}"
    echo ""
    echo "Options:"
    echo "  1) Backup and create new"
    echo "  2) Keep existing and exit"
    echo ""
    read -p "Choose option (1/2): " -n 1 -r
    echo ""

    if [[ $REPLY == "1" ]]; then
        BACKUP_FILE=".env.backup.$(date +%Y%m%d_%H%M%S)"
        cp .env "$BACKUP_FILE"
        echo -e "${GREEN}✓ Backed up to: $BACKUP_FILE${NC}"
    else
        echo "Keeping existing .env"
        echo ""
        echo "To manually edit: nano .env"
        exit 0
    fi
fi

# Copy template
if [ ! -f .env.production.example ]; then
    echo -e "${RED}✗ .env.production.example not found${NC}"
    exit 1
fi

cp .env.production.example .env
echo -e "${GREEN}✓ Created .env from template${NC}"
echo ""

# 1. Database Password
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. Database Password"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Generating secure database password..."
NEW_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-24)
echo -e "${BLUE}Generated: $NEW_PASSWORD${NC}"
echo ""
read -p "Use this password? (Y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo "Enter your own password:"
    read -r NEW_PASSWORD
fi

# Update password in both places
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/DB_PASSWORD=changeme/DB_PASSWORD=$NEW_PASSWORD/" .env
    sed -i '' "s/:changeme@/:$NEW_PASSWORD@/" .env
else
    # Linux
    sed -i "s/DB_PASSWORD=changeme/DB_PASSWORD=$NEW_PASSWORD/" .env
    sed -i "s/:changeme@/:$NEW_PASSWORD@/" .env
fi

echo -e "${GREEN}✓ Database password configured${NC}"
echo ""

# 2. OpenAI API Key
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2. OpenAI API Key"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Get your API key from: https://platform.openai.com/api-keys"
echo ""
echo "Enter your OpenAI API key (or press Enter to skip):"
read -r API_KEY

if [ -n "$API_KEY" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|OPENAI_API_KEY=your_openai_key_here|OPENAI_API_KEY=$API_KEY|" .env
    else
        sed -i "s|OPENAI_API_KEY=your_openai_key_here|OPENAI_API_KEY=$API_KEY|" .env
    fi
    echo -e "${GREEN}✓ API key configured${NC}"
else
    echo -e "${YELLOW}⚠ API key not set - you'll need to add it manually later${NC}"
fi
echo ""

# 3. Worker Count
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3. Gunicorn Workers"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Detect CPU cores
if command -v nproc &> /dev/null; then
    CPU_CORES=$(nproc)
elif command -v sysctl &> /dev/null; then
    CPU_CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo "4")
else
    CPU_CORES=4
fi

RECOMMENDED_WORKERS=$((2 * CPU_CORES + 1))

echo "Detected CPU cores: $CPU_CORES"
echo "Recommended workers: $RECOMMENDED_WORKERS (formula: 2 × cores + 1)"
echo ""
read -p "Use recommended worker count? (Y/n): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/GUNICORN_WORKERS=9/GUNICORN_WORKERS=$RECOMMENDED_WORKERS/" .env
    else
        sed -i "s/GUNICORN_WORKERS=9/GUNICORN_WORKERS=$RECOMMENDED_WORKERS/" .env
    fi
    echo -e "${GREEN}✓ Worker count set to $RECOMMENDED_WORKERS${NC}"
else
    echo "Enter custom worker count:"
    read -r CUSTOM_WORKERS
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/GUNICORN_WORKERS=9/GUNICORN_WORKERS=$CUSTOM_WORKERS/" .env
    else
        sed -i "s/GUNICORN_WORKERS=9/GUNICORN_WORKERS=$CUSTOM_WORKERS/" .env
    fi
    echo -e "${GREEN}✓ Worker count set to $CUSTOM_WORKERS${NC}"
fi
echo ""

# 4. Port Configuration
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4. Server Port"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Default port: 3002"
read -p "Use default port? (Y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo "Enter custom port:"
    read -r CUSTOM_PORT
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/PORT=3002/PORT=$CUSTOM_PORT/" .env
    else
        sed -i "s/PORT=3002/PORT=$CUSTOM_PORT/" .env
    fi
    echo -e "${GREEN}✓ Port set to $CUSTOM_PORT${NC}"
else
    echo -e "${GREEN}✓ Using default port 3002${NC}"
fi
echo ""

# 5. Session Expiry
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5. Session Expiry"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "How long should user sessions last?"
echo "  1) 1 day (high security)"
echo "  2) 7 days (balanced - default)"
echo "  3) 30 days (convenient)"
echo "  4) Custom"
echo ""
read -p "Choose option (1-4): " -n 1 -r
echo ""

case $REPLY in
    1)
        EXPIRY=1
        ;;
    3)
        EXPIRY=30
        ;;
    4)
        echo "Enter custom days:"
        read -r EXPIRY
        ;;
    *)
        EXPIRY=7
        ;;
esac

if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/SESSION_EXPIRY_DAYS=7/SESSION_EXPIRY_DAYS=$EXPIRY/" .env
else
    sed -i "s/SESSION_EXPIRY_DAYS=7/SESSION_EXPIRY_DAYS=$EXPIRY/" .env
fi

echo -e "${GREEN}✓ Session expiry set to $EXPIRY days${NC}"
echo ""

# Validation
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Validating Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

VALIDATION_PASSED=true

# Check DB_PASSWORD changed
if grep -q "DB_PASSWORD=changeme" .env; then
    echo -e "${RED}✗ Database password still set to default${NC}"
    VALIDATION_PASSED=false
else
    echo -e "${GREEN}✓ Database password changed from default${NC}"
fi

# Check passwords match
DB_PASS=$(grep "^DB_PASSWORD=" .env | cut -d= -f2)
URL_PASS=$(grep "^DATABASE_URL=" .env | grep -o "omegapoint:[^@]*@" | cut -d: -f2 | cut -d@ -f1)
if [ "$DB_PASS" = "$URL_PASS" ]; then
    echo -e "${GREEN}✓ Database passwords match${NC}"
else
    echo -e "${RED}✗ Password mismatch in DB_PASSWORD and DATABASE_URL${NC}"
    VALIDATION_PASSED=false
fi

# Check API key (warning only)
if grep -q "OPENAI_API_KEY=your_openai_key_here" .env; then
    echo -e "${YELLOW}⚠ OpenAI API key not configured (required for LLM features)${NC}"
else
    echo -e "${GREEN}✓ OpenAI API key configured${NC}"
fi

# Check NODE_ENV
if grep -q "NODE_ENV=production" .env; then
    echo -e "${GREEN}✓ Environment set to production${NC}"
else
    echo -e "${YELLOW}⚠ NODE_ENV not set to production${NC}"
fi

echo ""

# Set file permissions
chmod 600 .env
echo -e "${GREEN}✓ Set secure file permissions (600)${NC}"
echo ""

# Summary
echo "═══════════════════════════════════════════════════════════"
echo "  Configuration Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""

if [ "$VALIDATION_PASSED" = true ]; then
    echo -e "${GREEN}✅ All validations passed${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Review configuration: cat .env"
    echo "  2. Test deployment:     ./test_docker_deployment.sh"
    echo "  3. Start services:      docker-compose up --build -d"
    echo "  4. Check health:        ./health_check.sh"
else
    echo -e "${RED}❌ Some validations failed${NC}"
    echo ""
    echo "Please review and fix issues:"
    echo "  nano .env"
    echo ""
    echo "Then validate:"
    echo "  ./configure_env.sh"
fi

echo ""
echo "Configuration saved to: .env"
if [ -f ".env.backup."* ]; then
    echo "Backup saved to: $(ls -t .env.backup.* | head -1)"
fi
echo ""
