#!/bin/bash
# Container start: if migrations are pending, take a database snapshot FIRST, then
# apply them and start the API. A snapshot that fails stops the start, so a
# migration never runs against data with no backup behind it.
#
# Snapshots go to $PREMIGRATE_DIR (default /backups, a compose volume), as
# premigrate_<timestamp>.sql.gz; the newest $PREMIGRATE_KEEP (default 10) are kept.
set -euo pipefail

DIR="${PREMIGRATE_DIR:-/backups}"
KEEP="${PREMIGRATE_KEEP:-10}"

# `migrate status` exits non-zero when migrations are pending or one has failed.
if npx prisma migrate status >/dev/null 2>&1; then
  echo "[premigrate] database is up to date - no snapshot needed"
else
  mkdir -p "$DIR"
  # With BACKUP_ENCRYPTION_KEY set the snapshot is encrypted as it is written
  # (mysqldump | gzip | encrypt): the plain dump never touches the disk.
  EXT="sql.gz"; ENC=cat
  if [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then EXT="sql.gz.enc"; ENC="node dist/cli/backupCrypt.js encrypt"; fi
  FILE="$DIR/premigrate_$(date -u +%Y%m%d-%H%M%S).$EXT"
  echo "[premigrate] migrations pending - taking snapshot $FILE"
  # Connection details come from DATABASE_URL; the password goes in via MYSQL_PWD
  # so it never appears in a process list.
  url() { node -e 'const u = new URL(process.env.DATABASE_URL); console.log(('"$1"') ?? "")'; }
  H="$(url 'u.hostname')"
  P="$(url 'u.port || 3306')"
  U="$(url 'decodeURIComponent(u.username)')"
  W="$(url 'decodeURIComponent(u.password)')"
  D="$(url 'u.pathname.slice(1)')"
  if MYSQL_PWD="$W" mysqldump --host="$H" --port="$P" --user="$U" \
      --single-transaction --routines --triggers --no-tablespaces "$D" | gzip | $ENC > "$FILE.part"; then
    mv "$FILE.part" "$FILE"
    echo "[premigrate] snapshot saved ($(wc -c < "$FILE") bytes)"
  else
    rm -f "$FILE.part"
    echo "[premigrate] SNAPSHOT FAILED - not migrating. Fix the backup, then restart." >&2
    exit 1
  fi
  # Keep the newest $KEEP snapshots.
  # Housekeeping must never stop the start: `ls` exits non-zero when one of the two patterns
  # (plain / encrypted) matches nothing, which `set -e` + `pipefail` would turn into an exit
  # before the migration runs - so its status is swallowed.
  { ls -1t "$DIR"/premigrate_*.sql.gz "$DIR"/premigrate_*.sql.gz.enc 2>/dev/null || true; }     | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old"; done
fi

npx prisma migrate deploy
exec node dist/server.js
