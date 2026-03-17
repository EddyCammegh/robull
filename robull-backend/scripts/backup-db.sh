#!/usr/bin/env bash
set -euo pipefail

# ── Robull Database Backup ──────────────────────────────────────────
# Dumps the Postgres database to a timestamped .sql.gz file.
# Requires: DATABASE_URL env var, pg_dump, gzip
#
# Usage:
#   DATABASE_URL="postgres://..." ./backup-db.sh
#   Output: robull-backup-2026-03-17T020000Z.sql.gz

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

TIMESTAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
FILENAME="robull-backup-${TIMESTAMP}.sql.gz"
BACKUP_DIR="${BACKUP_DIR:-.}"

echo "[backup] Starting database backup at ${TIMESTAMP}..."

pg_dump "${DATABASE_URL}" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --format=plain \
  | gzip > "${BACKUP_DIR}/${FILENAME}"

SIZE=$(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1)
echo "[backup] Done: ${FILENAME} (${SIZE})"
