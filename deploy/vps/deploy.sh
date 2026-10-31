#!/usr/bin/env bash
#
# Update the Ala Eh Stocks Monitoring System on the VPS after a push.
# This is the "one deploy script per site" from the VPS guide, for this app.
#
#   bash /var/www/ala-eh/deploy/vps/deploy.sh
#
# What it does, in order, and stops at the first thing that fails:
#   1. git pull            (fast-forward only: it never merges or overwrites local edits)
#   2. npm ci              (exact versions from package-lock.json; the build needs the dev tools)
#   3. npm run build       (API -> server/dist, client -> client/dist, which Nginx serves)
#   4. npm run db:migrate:deploy
#                          (checks the migrations, takes a database snapshot, THEN migrates. If the
#                           snapshot fails, nothing is migrated.)
#   5. pm2 restart         (the API picks up the new code)
#   6. waits for /health/live to answer
#
# Nginx needs no change for a normal update: the client is served straight from client/dist.
# Run it as your normal user (the one that owns /var/www/ala-eh and runs PM2), not as root.
#
# Env: API_PORT (default 4000) - only for the final health check.

set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_PORT="${API_PORT:-4000}"
cd "$APP_DIR"

step() { printf '\n==> %s\n' "$1"; }
die() { printf '\nERROR: %s\n' "$1" >&2; exit 1; }

[[ "$(id -u)" -ne 0 ]] || die "Do not run this as root. Use the normal user that owns $APP_DIR and runs PM2."
[[ -f server/.env ]] || die "server/.env is missing. Create it first (docs/DEPLOY-VPS.md, step 5)."
command -v pm2 >/dev/null || die "pm2 is not installed (sudo npm install -g pm2)."

step "Pulling the latest code"
git pull --ff-only

step "Installing dependencies"
npm ci

step "Building (API and client)"
npm run build

step "Migrating the database (snapshot first)"
npm run db:migrate:deploy

step "Restarting the API"
# The process used to be called ala-eh-api. A server that still has it would otherwise start a
# second copy under the new name next to it, and the two would fight over the same port. Remove
# the old one once (a few seconds of downtime); pm2 then starts it again under its new name.
if pm2 describe ala-eh-api >/dev/null 2>&1; then
  echo "Renaming the PM2 process ala-eh-api -> alaeh-stocks"
  pm2 delete ala-eh-api
fi
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

step "Waiting for the API to answer on port $API_PORT"
up=""
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$API_PORT/health/live" >/dev/null 2>&1; then up=1; break; fi
  sleep 1
done
[[ -n "$up" ]] || die "The API did not answer. Look at: pm2 logs alaeh-stocks --lines 50"

printf '\nDeployed OK (%s)\n' "$(git log --oneline -1)"
printf 'Check it in the browser, and if .env.example gained new variables, add them to server/.env.\n'
