#!/bin/bash

# Run Omega Point server in development mode with alternative port
# This script uses .env.dev instead of .env

echo "🚀 Starting Omega Point in DEVELOPMENT mode..."
echo "   Port: 3003 (alternative to Docker's 3002)"
echo "   Config: .env.dev"
echo ""

# Check if .env.dev exists
if [ ! -f ".env.dev" ]; then
    echo "❌ Error: .env.dev not found!"
    echo "   Please create .env.dev with PORT=3003"
    exit 1
fi

# Backup current .env if it exists
if [ -f ".env" ]; then
    cp .env .env.backup.tmp
fi

# Use .env.dev
cp .env.dev .env

# Run the server
cd server && python app.py

# Restore original .env
cd ..
if [ -f ".env.backup.tmp" ]; then
    mv .env.backup.tmp .env
fi
