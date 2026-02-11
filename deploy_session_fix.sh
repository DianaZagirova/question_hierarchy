#!/bin/bash
# Quick deployment script for session isolation fix

set -e  # Exit on any error

echo "========================================"
echo "  Omega Point - Session Isolation Fix  "
echo "========================================"
echo ""

# Check if dist folder exists
if [ ! -d "dist" ]; then
    echo "❌ Error: dist folder not found"
    echo "Please run 'npm run build' first"
    exit 1
fi

# Check for required build file
if [ ! -f "dist/assets/index-kI_AJjYw.js" ]; then
    echo "⚠️  Warning: Expected build file not found"
    echo "You may be deploying an old build"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Prompt for remote server details
read -p "Remote server user@host (e.g., user@example.com): " REMOTE
if [ -z "$REMOTE" ]; then
    echo "❌ Error: Remote server not specified"
    exit 1
fi

read -p "Remote path (e.g., /opt/omega-point-app): " REMOTE_PATH
if [ -z "$REMOTE_PATH" ]; then
    echo "❌ Error: Remote path not specified"
    exit 1
fi

echo ""
echo "Deploying to: $REMOTE:$REMOTE_PATH"
echo ""

# Create tarball
echo "1/5 Creating tarball..."
tar -czf /tmp/omega-point-dist.tar.gz dist/
echo "    ✓ Created /tmp/omega-point-dist.tar.gz"

# Upload to remote
echo "2/5 Uploading to remote server..."
scp /tmp/omega-point-dist.tar.gz $REMOTE:/tmp/
echo "    ✓ Uploaded"

# Extract and deploy on remote
echo "3/5 Extracting on remote..."
ssh $REMOTE "cd $REMOTE_PATH && tar -xzf /tmp/omega-point-dist.tar.gz"
echo "    ✓ Extracted"

echo "4/5 Copying to container..."
ssh $REMOTE "cd $REMOTE_PATH && docker cp dist/. omega-point:/app/dist/"
echo "    ✓ Copied"

echo "5/5 Restarting container..."
ssh $REMOTE "cd $REMOTE_PATH && docker compose restart omega-point"
echo "    ✓ Restarted"

# Clean up
echo ""
echo "Cleaning up..."
rm /tmp/omega-point-dist.tar.gz
ssh $REMOTE "rm /tmp/omega-point-dist.tar.gz"
echo "    ✓ Cleaned up temporary files"

echo ""
echo "========================================"
echo "  ✅ Deployment Complete!               "
echo "========================================"
echo ""
echo "Verify deployment:"
echo "  ssh $REMOTE 'cd $REMOTE_PATH && docker compose logs --tail=30 omega-point'"
echo ""
echo "Check build file:"
echo "  ssh $REMOTE 'docker exec omega-point ls -la /app/dist/assets/ | grep index-kI_AJjYw.js'"
echo ""
echo "Test at: https://q0.openlongevity.work/"
echo ""
echo "Expected behavior:"
echo "  1. Create new session → Should be empty"
echo "  2. Add data to session 1"
echo "  3. Create session 2 → Should be empty (no data from session 1)"
echo "  4. Switch between sessions → Each maintains independent data"
echo ""
