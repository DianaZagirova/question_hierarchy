#!/bin/bash

# Omega Point - Development Quick Start Script
# This script starts both frontend and backend in development mode

set -e  # Exit on error

echo "🚀 Starting Omega Point Development Environment"
echo "================================================"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Creating from .env.example..."
    cp .env.example .env
    echo "✓ Created .env file"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env and add your API key!"
    echo "   Run: nano .env"
    echo "   Then set: OPENAI_API_KEY=sk-your-key-here"
    echo ""
    read -p "Press Enter after you've configured .env..."
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo "📦 Installing frontend dependencies..."
    npm install
    echo "✓ Frontend dependencies installed"
    echo ""
fi

# Check if Python packages are installed
echo "🐍 Checking backend dependencies..."
cd server
if ! python3 -c "import flask" 2>/dev/null; then
    echo "📦 Installing backend dependencies..."
    pip3 install -r requirements.txt
    echo "✓ Backend dependencies installed"
    echo ""
else
    echo "✓ Backend dependencies already installed"
    echo ""
fi
cd ..

# Check API key is set
API_KEY=$(grep -E "^OPENAI_API_KEY=" .env | cut -d'=' -f2)
if [ -z "$API_KEY" ] || [ "$API_KEY" = "your_openai_key_here" ]; then
    echo "⚠️  WARNING: OPENAI_API_KEY not configured in .env"
    echo "   The app won't be able to call LLMs without a valid API key."
    echo ""
fi

echo "✨ Starting development servers..."
echo ""
echo "Frontend will be at: http://localhost:5173"
echo "Backend will be at:  http://localhost:3002"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""
echo "================================================"
echo ""

# Start both servers (concurrently if available, otherwise sequential)
if command -v concurrently &> /dev/null; then
    npm run dev:all
else
    echo "⚠️  'concurrently' not found. Installing..."
    npm install -g concurrently
    npm run dev:all
fi
