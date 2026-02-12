#!/bin/bash

# Database Backup Script for Omega Point
# Backs up PostgreSQL database to local directory

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
CONTAINER_NAME="omega-point-postgres"
DB_USER="omegapoint"
DB_NAME="omegapoint"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="omegapoint_${TIMESTAMP}.sql.gz"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "═══════════════════════════════════════════════════════════"
echo "  Omega Point - Database Backup"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if Docker is running
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Error: Docker not found${NC}"
    exit 1
fi

# Check if container exists
if ! docker ps | grep -q "$CONTAINER_NAME"; then
    echo -e "${RED}✗ Error: PostgreSQL container not running${NC}"
    exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Perform backup
echo -e "📦 Creating backup: ${BACKUP_FILE}"
if docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "${BACKUP_DIR}/${BACKUP_FILE}"; then
    BACKUP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}" | cut -f1)
    echo -e "${GREEN}✓ Backup completed: ${BACKUP_SIZE}${NC}"
    echo -e "  Location: ${BACKUP_DIR}/${BACKUP_FILE}"
else
    echo -e "${RED}✗ Backup failed${NC}"
    exit 1
fi

# Cleanup old backups
echo ""
echo "🗑️  Cleaning up backups older than ${RETENTION_DAYS} days..."
DELETED=$(find "$BACKUP_DIR" -name "omegapoint_*.sql.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
    echo -e "${YELLOW}  Deleted ${DELETED} old backup(s)${NC}"
else
    echo "  No old backups to delete"
fi

# List recent backups
echo ""
echo "📋 Recent backups:"
ls -lh "$BACKUP_DIR"/omegapoint_*.sql.gz | tail -5 | awk '{print "  " $9, "(" $5 ")"}'

echo ""
echo -e "${GREEN}✅ Backup process complete${NC}"
