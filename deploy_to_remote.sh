#!/bin/bash
# Quick deployment script for remote server

# Configuration (edit these)
REMOTE_USER="your_user"
REMOTE_HOST="your_server"
REMOTE_PATH="/path/to/omega-point-app"

echo "=== Omega Point Remote Deployment ==="
echo ""
echo "Deploying to: $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH"
echo ""

# Check if dist folder exists
if [ ! -d "dist" ]; then
    echo "Error: dist folder not found. Please run 'npm run build' first."
    exit 1
fi

# Create tarball
echo "1. Creating dist.tar.gz..."
tar -czf dist.tar.gz dist/
echo "   ✓ Created dist.tar.gz"

# Upload to remote
echo "2. Uploading to remote server..."
scp dist.tar.gz $REMOTE_USER@$REMOTE_HOST:/tmp/
echo "   ✓ Uploaded to /tmp/dist.tar.gz"

# Extract and deploy on remote
echo "3. Deploying on remote server..."
ssh $REMOTE_USER@$REMOTE_HOST << 'EOF'
cd /path/to/omega-point-app
echo "   - Extracting dist.tar.gz..."
tar -xzf /tmp/dist.tar.gz
echo "   - Copying to container..."
docker cp dist/. omega-point:/app/dist/
echo "   - Restarting container..."
docker compose restart omega-point
echo "   - Cleaning up..."
rm /tmp/dist.tar.gz
echo "   ✓ Deployment complete!"
EOF

# Clean up local tarball
echo "4. Cleaning up..."
rm dist.tar.gz
echo "   ✓ Removed local dist.tar.gz"

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Verify deployment:"
echo "  ssh $REMOTE_USER@$REMOTE_HOST 'cd $REMOTE_PATH && docker compose logs --tail=20 omega-point'"
echo ""
echo "Test session isolation at: https://q0.openlongevity.work/"
