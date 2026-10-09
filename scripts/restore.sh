#!/usr/bin/env bash
#
# Restore the database from a backup produced by scripts/backup.sh (or
# backup.ps1 - the artifacts are interchangeable). Linux/VPS counterpart of
# scripts/restore.ps1.
#
# This REPLACES the contents of the target database. It therefore refuses to
# run without an explicit --yes, and takes its own safety snapshot first so a
# restore of the wrong file is itself recoverable.
#
# Usage:
#   scripts/restore.sh --file /var/backups/ala-eh/daily/db_backup_2026-10-09_020000.sql.gz --yes
#   scripts/restore.sh --latest --yes
#
# Env: DATABASE_URL (required, read from server/.env if present),
#      BACKUP_DIR (default /var/backups/ala-eh), MYSQL_PATH, MYSQLDUMP_PATH.

set -Eeuo pipefail

FILE=""
LATEST=0
CONFIRMED=0
SKIP_SAFETY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) FILE="${2:?--file needs a path}"; shift 2 ;;
    --latest) LATEST=1; shift ;;
    --yes) CONFIRMED=1; shift ;;
    --no-safety-snapshot) SKIP_SAFETY=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

log() { printf '%s [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${2:-INFO}" "$1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

if [[ -z "${DATABASE_URL:-}" && -f "$REPO_ROOT/server/.env" ]]; then
  DATABASE_URL="$(grep -E '^[[:space:]]*DATABASE_URL[[:space:]]*=' "$REPO_ROOT/server/.env" \
    | tail -n 1 | sed -E 's/^[^=]*=[[:space:]]*//; s/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//')"
fi
: "${DATABASE_URL:?DATABASE_URL is not set and was not found in server/.env}"

urldecode() { printf '%b' "${1//%/\\x}"; }
proto_stripped="${DATABASE_URL#*://}"
credentials="${proto_stripped%%@*}"
hostpath="${proto_stripped#*@}"
DB_USER="$(urldecode "${credentials%%:*}")"
DB_PASS="$(urldecode "${credentials#*:}")"
hostport="${hostpath%%/*}"
DB_HOST="${hostport%%:*}"
DB_PORT="${hostport#*:}"
[[ "$DB_PORT" == "$DB_HOST" ]] && DB_PORT=3306
DB_NAME="${hostpath#*/}"
DB_NAME="${DB_NAME%%\?*}"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/ala-eh}"

if (( LATEST )); then
  FILE="$(ls -1t "$BACKUP_DIR"/daily/*.sql.gz "$BACKUP_DIR"/snapshots/*.sql.gz 2>/dev/null | head -n 1 || true)"
  [[ -n "$FILE" ]] || { log "No backups found under $BACKUP_DIR" ERROR; exit 1; }
fi
[[ -n "$FILE" ]] || { log "Pass --file <path> or --latest" ERROR; exit 2; }
[[ -f "$FILE" ]] || { log "No such backup: $FILE" ERROR; exit 1; }

# --- verify the archive BEFORE touching the live database --------------------
# Restoring a truncated dump is how a bad backup becomes a bad database: the
# mysql client applies whatever statements it got and exits 0, leaving a
# half-populated schema that looks restored.
if ! gzip -dc "$FILE" 2>/dev/null | head -n 1 | grep -qE '^-- (MySQL|MariaDB) dump'; then
  log "Refusing to restore: $FILE is not a recognisable MySQL dump." ERROR
  exit 1
fi
if ! gzip -dc "$FILE" 2>/dev/null | tail -n 5 | grep -q '^-- Dump completed'; then
  log "Refusing to restore: $FILE is truncated (no 'Dump completed' trailer)." ERROR
  exit 1
fi

if (( ! CONFIRMED )); then
  log "This REPLACES every table in '$DB_NAME' on $DB_HOST:$DB_PORT with the contents of:" WARN
  log "  $FILE" WARN
  log "Re-run with --yes to proceed." WARN
  exit 2
fi

export MYSQL_PWD="$DB_PASS"

# --- safety snapshot ---------------------------------------------------------
# Taken of the CURRENT database, so restoring the wrong file is recoverable.
if (( ! SKIP_SAFETY )); then
  log "Taking a safety snapshot of the current '$DB_NAME' first..."
  BACKUP_DIR="$BACKUP_DIR" "$SCRIPT_DIR/backup.sh" --mode snapshot --label pre-restore
fi

log "Restoring '$DB_NAME' from $FILE"
gzip -dc "$FILE" | "${MYSQL_PATH:-mysql}" \
  --host "$DB_HOST" --port "$DB_PORT" --user "$DB_USER" \
  --default-character-set=utf8mb4 "$DB_NAME"

log "Restore OK. Run 'npm run prisma:migrate:deploy --workspace server' if the dump predates the current schema."
exit 0
