#!/bin/bash

# Session Export Backup Script for Omega Point
# Exports all sessions via API to JSON backup

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups/sessions}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
API_URL="${API_URL:-http://localhost:3002}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="sessions_${TIMESTAMP}.json"
COOKIE_FILE=$(mktemp)

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Cleanup temp file on exit
trap "rm -f $COOKIE_FILE" EXIT

echo "═══════════════════════════════════════════════════════════"
echo "  Omega Point - Sessions Backup"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Get session cookie
echo "🔑 Authenticating..."
if ! curl -s -f -c "$COOKIE_FILE" "$API_URL/api/session/validate" > /dev/null 2>&1; then
    echo -e "${RED}✗ Error: Cannot connect to API${NC}"
    echo "  Make sure the server is running at $API_URL"
    exit 1
fi

# Export sessions
echo "📦 Exporting sessions..."
if curl -s -f -b "$COOKIE_FILE" "$API_URL/api/export/all" -o "${BACKUP_DIR}/${BACKUP_FILE}" 2>&1; then
    # Verify JSON is valid
    if python3 -m json.tool "${BACKUP_DIR}/${BACKUP_FILE}" > /dev/null 2>&1; then
        BACKUP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}" | cut -f1)
        SESSION_COUNT=$(python3 -c "import json; print(json.load(open('${BACKUP_DIR}/${BACKUP_FILE}'))['metadata']['total_sessions'])" 2>/dev/null || echo "unknown")

        echo -e "${GREEN}✓ Export completed${NC}"
        echo -e "  Sessions: ${SESSION_COUNT}"
        echo -e "  Size: ${BACKUP_SIZE}"
        echo -e "  Location: ${BACKUP_DIR}/${BACKUP_FILE}"
    else
        echo -e "${RED}✗ Export produced invalid JSON${NC}"
        rm -f "${BACKUP_DIR}/${BACKUP_FILE}"
        exit 1
    fi
else
    echo -e "${RED}✗ Export failed${NC}"
    exit 1
fi

# Cleanup old backups
echo ""
echo "🗑️  Cleaning up backups older than ${RETENTION_DAYS} days..."
DELETED=$(find "$BACKUP_DIR" -name "sessions_*.json" -mtime +$RETENTION_DAYS -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
    echo -e "${YELLOW}  Deleted ${DELETED} old backup(s)${NC}"
else
    echo "  No old backups to delete"
fi

# List recent backups
echo ""
echo "📋 Recent backups:"
ls -lh "$BACKUP_DIR"/sessions_*.json | tail -5 | awk '{print "  " $9, "(" $5 ")"}'

echo ""
echo -e "${GREEN}✅ Backup process complete${NC}"
