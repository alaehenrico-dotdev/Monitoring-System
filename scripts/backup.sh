#!/usr/bin/env bash
#
# Compressed, verified local database backup with retention - the Linux/VPS
# counterpart of scripts/backup.ps1, with deliberately identical semantics so
# a backup taken on either platform is the same artifact and restores the
# same way. (This app has no user-uploaded files - stock data lives entirely
# in MySQL - so there is no separate files archive.)
#
# Modes:
#   daily     (default) timestamped dump in $BACKUP_DIR/daily, then purge
#             dumps older than RETENTION_DAYS, always keeping the newest one
#             whatever its age.
#   snapshot  quick dump into $BACKUP_DIR/snapshots, run before a schema
#             migration or an update (npm run backup:snapshot). Kept apart so
#             the daily purge never eats it; only the newest KEEP_SNAPSHOTS
#             are retained.
#
# Usage:
#   scripts/backup.sh
#   scripts/backup.sh --mode snapshot --label pre-migration
#
# Env: DATABASE_URL (required, read from server/.env if present),
#      BACKUP_DIR (default /var/backups/ala-eh), MYSQLDUMP_PATH.

# Exit on error, on unset variable, and make a failing stage of a pipeline
# fail the whole pipeline - without pipefail, `mysqldump | gzip` reports
# gzip's success and a failed dump would be written as a "good" backup.
set -Eeuo pipefail

MODE="daily"
LABEL=""
RETENTION_DAYS="${RETENTION_DAYS:-7}"
KEEP_SNAPSHOTS="${KEEP_SNAPSHOTS:-10}"
# Refuse to start with less free space than this (MB), or than 3x the
# previous dump, whichever is larger.
MIN_FREE_MB="${MIN_FREE_MB:-500}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:?--mode needs a value}"; shift 2 ;;
    --label) LABEL="${2:?--label needs a value}"; shift 2 ;;
    --backup-dir) BACKUP_DIR="${2:?--backup-dir needs a value}"; shift 2 ;;
    --retention-days) RETENTION_DAYS="${2:?}"; shift 2 ;;
    --keep-snapshots) KEEP_SNAPSHOTS="${2:?}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$MODE" in daily|snapshot) ;; *) echo "--mode must be daily or snapshot" >&2; exit 2 ;; esac

log() { printf '%s [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${2:-INFO}" "$1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Read DATABASE_URL out of server/.env when it isn't already exported - the
# same file the API itself reads, so a cron job can never back up a different
# database than the one being served. Deliberately only this one key, parsed
# rather than sourced: `source`ing a .env executes whatever is in it.
if [[ -z "${DATABASE_URL:-}" && -f "$REPO_ROOT/server/.env" ]]; then
  DATABASE_URL="$(grep -E '^[[:space:]]*DATABASE_URL[[:space:]]*=' "$REPO_ROOT/server/.env" \
    | tail -n 1 | sed -E 's/^[^=]*=[[:space:]]*//; s/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//')"
fi
: "${DATABASE_URL:?DATABASE_URL is not set and was not found in server/.env}"

# mysql://user:pass@host:port/database?params - parsed with the same rules the
# API uses (server/src/services/backup.service.ts), including percent-decoding
# the credentials, so a password containing @ or : works here too.
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
SUB="daily"; [[ "$MODE" == "snapshot" ]] && SUB="snapshots"
TARGET_DIR="$BACKUP_DIR/$SUB"
mkdir -p "$TARGET_DIR"
# Dumps contain every stock figure and every password hash in the system.
chmod 700 "$BACKUP_DIR" "$TARGET_DIR" 2>/dev/null || true

# --- disk space safety check -------------------------------------------------
FREE_MB="$(df -Pm "$TARGET_DIR" | awk 'NR==2 {print $4}')"
NEED_MB="$MIN_FREE_MB"
LAST_DUMP="$(ls -1t "$TARGET_DIR"/*.sql.gz 2>/dev/null | head -n 1 || true)"
if [[ -n "$LAST_DUMP" ]]; then
  LAST_MB=$(( ( $(stat -c %s "$LAST_DUMP") * 3 + 1048575 ) / 1048576 ))
  (( LAST_MB > NEED_MB )) && NEED_MB="$LAST_MB"
fi
if (( FREE_MB < NEED_MB )); then
  log "Not enough disk space on $TARGET_DIR (${FREE_MB} MB free, need ${NEED_MB} MB). Nothing was written." ERROR
  exit 1
fi

STAMP="$(date '+%Y-%m-%d_%H%M%S')"
NAME="db_backup_$STAMP"
if [[ -n "$LABEL" ]]; then NAME+="_$(printf '%s' "$LABEL" | tr -cd 'A-Za-z0-9_-')"; fi
FINAL="$TARGET_DIR/$NAME.sql.gz"
PARTIAL="$FINAL.partial"

# Any failure or interrupt from here on must not leave a half-written file
# that retention could later mistake for a good backup.
cleanup() { [[ -f "$PARTIAL" ]] && rm -f "$PARTIAL"; }
trap cleanup ERR INT TERM

log "Starting $MODE backup of '$DB_NAME' -> $FINAL"

# MYSQL_PWD rather than --password=, which would expose the password to
# anyone who can run `ps` on this host. Exported only for these children.
export MYSQL_PWD="$DB_PASS"
"${MYSQLDUMP_PATH:-mysqldump}" \
  --host "$DB_HOST" --port "$DB_PORT" --user "$DB_USER" \
  --single-transaction --routines --triggers \
  --no-tablespaces \
  "$DB_NAME" | gzip -c > "$PARTIAL"

# --- verify before publishing ------------------------------------------------
# A dump is only trusted if it starts with the MySQL/MariaDB header AND ends
# with the "Dump completed" trailer mysqldump writes last - which is what
# tells a truncated dump (disk full, killed mid-stream, lost connection) from
# a complete one. Same two checks as Test-DumpFile in backup-common.ps1.
if ! gzip -dc "$PARTIAL" 2>/dev/null | head -n 1 | grep -qE '^-- (MySQL|MariaDB) dump'; then
  log "Verification failed - no dump header. Discarded." ERROR
  exit 1
fi
if ! gzip -dc "$PARTIAL" 2>/dev/null | tail -n 5 | grep -q '^-- Dump completed'; then
  log "Verification failed - the dump is incomplete or unreadable. Discarded." ERROR
  exit 1
fi

mv "$PARTIAL" "$FINAL"
chmod 600 "$FINAL"
trap - ERR INT TERM
log "Backup OK: $FINAL ($(( $(stat -c %s "$FINAL") / 1024 )) KB, verified)"

# --- retention ---------------------------------------------------------------
if [[ "$MODE" == "daily" ]]; then
  # Skip the newest regardless of age, then delete whatever is older than the
  # cutoff - so a machine that was off for a month still has its last backup.
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    rm -f "$f" && log "Purged old backup: $(basename "$f")"
  done < <(ls -1t "$TARGET_DIR"/db_backup_*.sql.gz 2>/dev/null | tail -n +2 \
            | while IFS= read -r f; do
                if [[ $(( ( $(date +%s) - $(stat -c %Y "$f") ) / 86400 )) -ge $RETENTION_DAYS ]]; then echo "$f"; fi
              done)
else
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    rm -f "$f" && log "Purged old snapshot: $(basename "$f")"
  done < <(ls -1t "$TARGET_DIR"/db_backup_*.sql.gz 2>/dev/null | tail -n +$(( KEEP_SNAPSHOTS + 1 )))
fi

# Leftovers from a run that was killed mid-dump before the trap could fire.
find "$TARGET_DIR" -name '*.partial' -mmin +360 -delete 2>/dev/null || true
exit 0
