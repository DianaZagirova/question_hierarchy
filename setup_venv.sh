#!/bin/bash

echo "Setting up Python virtual environment for Omega Point..."

# Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    echo "✓ Virtual environment created"
else
    echo "✓ Virtual environment already exists"
fi

# Activate venv
echo ""
echo "To activate the virtual environment, run:"
echo "  source venv/bin/activate"
echo ""
echo "Then install dependencies:"
echo "  pip install -r server/requirements.txt"
echo ""
echo "To deactivate later, run:"
echo "  deactivate"
