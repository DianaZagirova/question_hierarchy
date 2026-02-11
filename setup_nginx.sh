#!/bin/bash

# Nginx Setup Script for Omega Point with Cloudflare
# Run this on your server to configure Nginx reverse proxy

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Omega Point - Nginx Setup for Cloudflare"
echo "════════════════════════════════════════════════════════════"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}✗ Please run as root (use sudo)${NC}"
    exit 1
fi

# Get domain name
echo -e "${BLUE}Enter your domain name (e.g., omega-point.yourdomain.com):${NC}"
read -r DOMAIN

if [ -z "$DOMAIN" ]; then
    echo -e "${RED}✗ Domain name is required${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ Domain: $DOMAIN${NC}"
echo ""

# Install Nginx if not present
if ! command -v nginx &> /dev/null; then
    echo -e "${YELLOW}Installing Nginx...${NC}"
    apt update && apt install nginx -y
    echo -e "${GREEN}✓ Nginx installed${NC}"
else
    echo -e "${GREEN}✓ Nginx already installed${NC}"
fi

# Create SSL directory
echo ""
echo -e "${YELLOW}Creating SSL directory...${NC}"
mkdir -p /etc/ssl/cloudflare
chmod 755 /etc/ssl/cloudflare
echo -e "${GREEN}✓ SSL directory created${NC}"

# Generate Nginx configuration
echo ""
echo -e "${YELLOW}Generating Nginx configuration...${NC}"

cat > /etc/nginx/sites-available/omega-point <<EOF
# Omega Point - Nginx Configuration
# Generated on $(date)

# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

# HTTPS Server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;

    # SSL Configuration (Cloudflare Origin Certificate)
    ssl_certificate /etc/ssl/cloudflare/cert.pem;
    ssl_certificate_key /etc/ssl/cloudflare/key.pem;

    # SSL Security
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Client upload size
    client_max_body_size 100M;

    # Logging
    access_log /var/log/nginx/omega-point-access.log;
    error_log /var/log/nginx/omega-point-error.log;

    # Proxy to Docker container
    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        # Headers
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Timeouts
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
        proxy_read_timeout 300;
        send_timeout 300;
    }

    # API endpoints with SSE support
    location /api/ {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # SSE support for progress streaming
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
    }
}
EOF

echo -e "${GREEN}✓ Configuration created: /etc/nginx/sites-available/omega-point${NC}"

# Enable site
echo ""
echo -e "${YELLOW}Enabling site...${NC}"
ln -sf /etc/nginx/sites-available/omega-point /etc/nginx/sites-enabled/
echo -e "${GREEN}✓ Site enabled${NC}"

# Remove default site
if [ -f /etc/nginx/sites-enabled/default ]; then
    echo ""
    echo -e "${YELLOW}Removing default site...${NC}"
    rm /etc/nginx/sites-enabled/default
    echo -e "${GREEN}✓ Default site removed${NC}"
fi

# Test configuration
echo ""
echo -e "${YELLOW}Testing Nginx configuration...${NC}"
if nginx -t 2>&1 | grep -q "successful"; then
    echo -e "${GREEN}✓ Configuration test passed${NC}"
else
    echo -e "${RED}✗ Configuration test failed${NC}"
    nginx -t
    exit 1
fi

# Instructions for SSL certificates
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Next Steps"
echo "════════════════════════════════════════════════════════════"
echo ""
echo -e "${YELLOW}⚠ SSL Certificates Required${NC}"
echo ""
echo "1. Go to Cloudflare Dashboard → SSL/TLS → Origin Server"
echo "2. Click 'Create Certificate'"
echo "3. Copy the certificate and private key"
echo ""
echo "4. Save certificate:"
echo -e "   ${BLUE}sudo nano /etc/ssl/cloudflare/cert.pem${NC}"
echo ""
echo "5. Save private key:"
echo -e "   ${BLUE}sudo nano /etc/ssl/cloudflare/key.pem${NC}"
echo ""
echo "6. Set permissions:"
echo -e "   ${BLUE}sudo chmod 644 /etc/ssl/cloudflare/cert.pem${NC}"
echo -e "   ${BLUE}sudo chmod 600 /etc/ssl/cloudflare/key.pem${NC}"
echo ""
echo "7. Reload Nginx:"
echo -e "   ${BLUE}sudo systemctl reload nginx${NC}"
echo ""
echo "════════════════════════════════════════════════════════════"
echo ""

# Ask if user wants to configure firewall
echo -e "${BLUE}Configure firewall (ufw)? (y/N):${NC}"
read -r -n 1 CONFIGURE_FW
echo ""

if [[ $CONFIGURE_FW =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${YELLOW}Configuring firewall...${NC}"

    if ! command -v ufw &> /dev/null; then
        echo -e "${YELLOW}Installing ufw...${NC}"
        apt install ufw -y
    fi

    # Allow SSH first (important!)
    ufw allow ssh

    # Allow HTTP and HTTPS
    ufw allow 80/tcp
    ufw allow 443/tcp

    # Enable firewall
    echo "y" | ufw enable

    echo -e "${GREEN}✓ Firewall configured${NC}"
    ufw status
fi

echo ""
echo -e "${GREEN}✓ Setup complete!${NC}"
echo ""
echo "Configuration file: /etc/nginx/sites-available/omega-point"
echo "Logs: /var/log/nginx/omega-point-*.log"
echo ""
