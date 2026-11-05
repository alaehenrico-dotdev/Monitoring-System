#!/usr/bin/env bash
#
# Restore DRILL: proves a backup file can really be restored, without touching the live
# database. Restores the file into a throw-away database next to the real one (using
# scripts/restore.sh, so encrypted .enc backups, the truncation checks and the
# BACKUP_ENCRYPTION_KEY handling are exactly the ones a real restore uses), checks that
# the data came back, and drops the throw-away database again - always, even on failure.
#
# Run it monthly, and after changing the backup key or the backup setup. A backup that has
# never been restored is only a hope.
#
# Usage:
#   scripts/restore-drill.sh --latest
#   scripts/restore-drill.sh --file /var/backups/alaeh-stocks/daily/db_backup_2026-10-09_020000.sql.gz.enc
#   scripts/restore-drill.sh --latest --dry-run     # show what it would do, touch nothing
#
# A backup copied down from Google Drive works too: pass its path with --file.
#
# Env: DATABASE_URL (read from server/.env if present) - its user must be allowed to
#      CREATE and DROP databases; BACKUP_ENCRYPTION_KEY and BACKUP_DIR as for restore.sh;
#      MYSQL_PATH. Needs the `mysql` client.
# Exit: 0 = restored and checked, 1 = the drill failed (read the message), 2 = bad usage.

set -Eeuo pipefail

FILE=""
LATEST=0
DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) FILE="${2:?--file needs a path}"; shift 2 ;;
    --latest) LATEST=1; shift ;;
    --dry-run) DRY=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$FILE" || $LATEST -eq 1 ]] || { echo "Pass --file <path> or --latest" >&2; exit 2; }

log() { printf '%s [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${2:-INFO}" "$1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

if [[ -z "${DATABASE_URL:-}" && -f "$REPO_ROOT/server/.env" ]]; then
  DATABASE_URL="$(grep -E '^[[:space:]]*DATABASE_URL[[:space:]]*=' "$REPO_ROOT/server/.env" \
    | tail -n 1 | sed -E 's/^[^=]*=[[:space:]]*//; s/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//')"
fi
: "${DATABASE_URL:?DATABASE_URL is not set and was not found in server/.env}"

urldecode() { printf '%b' "${1//%/\x}"; }
rest="${DATABASE_URL#*://}"
credentials="${rest%%@*}"
hostpath="${rest#*@}"
DB_USER="$(urldecode "${credentials%%:*}")"
DB_PASS="$(urldecode "${credentials#*:}")"
hostport="${hostpath%%/*}"
DB_HOST="${hostport%%:*}"
DB_PORT="${hostport#*:}"
[[ "$DB_PORT" == "$DB_HOST" ]] && DB_PORT=3306
LIVE_DB="${hostpath#*/}"
LIVE_DB="${LIVE_DB%%\?*}"

# The throw-away database. The prefix is what the DROP below insists on, so this script
# can never be talked into dropping a real database.
DRILL_DB="restore_drill_$(date '+%Y%m%d%H%M%S')"
[[ "$DRILL_DB" == restore_drill_* && "$DRILL_DB" != "$LIVE_DB" ]] || { log "Refusing: bad drill database name." ERROR; exit 1; }
DRILL_URL="mysql://${credentials}@${hostport}/${DRILL_DB}"

MYSQL="${MYSQL_PATH:-mysql}"
export MYSQL_PWD="$DB_PASS"
sql() { "$MYSQL" --host "$DB_HOST" --port "$DB_PORT" --user "$DB_USER" --batch --skip-column-names "$@"; }

if (( DRY )); then
  log "DRY RUN - nothing is touched. Would:"
  log "  1. create database $DRILL_DB on $DB_HOST:$DB_PORT (live database '$LIVE_DB' is never written)"
  log "  2. restore ${FILE:-the newest backup} into it with scripts/restore.sh"
  log "  3. check the core tables exist and hold data"
  log "  4. drop $DRILL_DB"
  exit 0
fi

dropped=0
cleanup() {
  if (( ! dropped )) && [[ "$DRILL_DB" == restore_drill_* ]]; then
    sql -e "DROP DATABASE IF EXISTS \`$DRILL_DB\`" >/dev/null 2>&1 || log "Could not drop $DRILL_DB - drop it by hand." WARN
  fi
}
trap cleanup EXIT

log "Creating scratch database $DRILL_DB ..."
sql -e "CREATE DATABASE \`$DRILL_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

args=(--yes --no-safety-snapshot)
if [[ -n "$FILE" ]]; then args+=(--file "$FILE"); else args+=(--latest); fi
log "Restoring into $DRILL_DB ..."
DATABASE_URL="$DRILL_URL" "$SCRIPT_DIR/restore.sh" "${args[@]}"

# --- did the data really come back? ------------------------------------------
fail=0
count() { sql "$DRILL_DB" -e "SELECT COUNT(*) FROM \`$1\`" 2>/dev/null || echo "MISSING"; }

log "Checking what came back:"
for table in users products daily_online_stock daily_offline_stock manual_counts day_closures change_log _prisma_migrations; do
  n="$(count "$table")"
  if [[ "$n" == "MISSING" ]]; then
    log "  $table: MISSING" ERROR; fail=1
  else
    printf '           %-24s %s rows\n' "$table" "$n"
  fi
done
# A restore that "worked" but brought back no accounts or products is not a usable backup.
for table in users products _prisma_migrations; do
  n="$(count "$table")"
  if [[ "$n" == "0" ]]; then log "  $table is EMPTY in the backup" ERROR; fail=1; fi
done
newest="$(sql "$DRILL_DB" -e "SELECT MAX(date) FROM daily_online_stock" 2>/dev/null || true)"
log "  newest stock entry in the backup: ${newest:-none}"

sql -e "DROP DATABASE \`$DRILL_DB\`" && dropped=1
if (( fail )); then
  log "DRILL FAILED: the file restored, but the data is not all there. Do not rely on this backup." ERROR
  exit 1
fi
log "DRILL PASSED: the backup restores and holds data. Scratch database dropped."
