#!/usr/bin/env bash
#
# Update the Ala Eh Stocks Monitoring System on the VPS after a push.
# This is the "one deploy script per site" from the VPS guide, for this app.
#
#   bash /var/www/ala-eh/deploy/vps/deploy.sh            # by hand: the newest commit on GitHub
#   bash /var/www/ala-eh/deploy/vps/deploy.sh <commit>   # GitHub Actions: the commit CI tested
#
# What it does, in order, and stops at the first thing that fails:
#   1. git fetch + fast-forward to the commit asked for (it never merges or overwrites local
#      edits). Given a commit, it deploys exactly that one - not whatever was pushed after it -
#      and does nothing if the server is already past it.
#   2. npm ci              (exact versions from package-lock.json; the build needs the dev tools)
#   3. npm run build       (API -> server/dist, client -> client/dist, which Nginx serves)
#   4. npm run db:migrate:deploy
#                          (checks the migrations, takes a database snapshot, THEN migrates. If the
#                           snapshot fails, nothing is migrated.)
#   5. pm2 restart         (the API picks up the new code)
#   6. waits for /health/live to answer
#
# If a step after 1 fails, it goes back to the commit that was running (code, dependencies, build,
# restart) and checks that the API answers again, so a bad release does not leave the site down.
# It still exits with an error, so the failed deploy is seen. The one case it does NOT go back by
# itself: the release brought database migrations and the migration step was reached. Old code on
# a changed database is a decision for a person; it prints what to do instead.
#
# Nginx needs no change for a normal update: the client is served straight from client/dist.
# Run it as your normal user (the one that owns /var/www/ala-eh and runs PM2), not as root.
#
# Env: API_PORT (default 4000) - only for the health check.

set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SELF="$APP_DIR/deploy/vps/deploy.sh"
API_PORT="${API_PORT:-4000}"

# What to go back to if the release fails (empty = nothing to undo), how far the release got,
# and whether it carries database migrations.
ROLLBACK_TO=""
STAGE="start"
HAS_MIGRATIONS=""

step() { printf '\n==> %s\n' "$1"; }
die() { printf '\nERROR: %s\n' "$1" >&2; exit 1; }

wait_for_api() {
  local _
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$API_PORT/health/live" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

restart_api() {
  # The process used to be called ala-eh-api. A server that still has it would otherwise start a
  # second copy under the new name next to it, and the two would fight over the same port. Remove
  # the old one once (a few seconds of downtime); pm2 then starts it again under its new name.
  if pm2 describe ala-eh-api >/dev/null 2>&1; then
    echo "Renaming the PM2 process ala-eh-api -> alaeh-stocks"
    pm2 delete ala-eh-api
  fi
  pm2 startOrReload ecosystem.config.cjs --update-env
  pm2 save
}

# Step 1. Leaves the working copy on the commit to release.
update_code() {
  local want="${1:-}" branch target
  step "Getting the code to deploy"
  branch="$(git rev-parse --abbrev-ref HEAD)"
  [[ "$branch" != "HEAD" ]] || die "This copy is not on a branch (detached HEAD). Run: git checkout main"
  git fetch origin "$branch"

  if [[ -n "$want" ]]; then
    [[ "$want" =~ ^[0-9a-fA-F]{7,40}$ ]] || die "'$want' is not a commit id."
    target="$(git rev-parse --verify --quiet "$want^{commit}")" || die "Commit $want is not on GitHub's $branch (was it rewritten?)."
    git merge-base --is-ancestor "$target" "origin/$branch" || die "Commit $want is not part of origin/$branch; refusing to deploy it."
    # A deploy that was queued behind a newer one: the server is already past this commit.
    if [[ "$(git rev-parse HEAD)" != "$target" ]] && git merge-base --is-ancestor "$target" HEAD; then
      printf '\nNothing to do: the server is on %s, which already includes %s.\n' "$(git rev-parse --short HEAD)" "${want:0:7}"
      exit 0
    fi
  else
    target="$(git rev-parse "origin/$branch")"
  fi

  # The server's copy must be an ancestor of what is on GitHub. It stops being one when a commit
  # that was already deployed is amended or rebased and force-pushed: say so, instead of git's
  # "Not possible to fast-forward".
  if ! git merge-base --is-ancestor HEAD "$target"; then
    die "This copy ($(git rev-parse --short HEAD)) is not part of origin/$branch any more - a deployed commit was rewritten (amend / rebase + force-push), or someone committed on the server.
If nothing was edited here on purpose (check: git status, git log origin/$branch..HEAD), line it up once, then deploy again:
    git reset --hard origin/$branch"
  fi
  git merge --ff-only "$target"
}

# Back to the commit that was running. Never called for a release that may have changed the database.
roll_back() {
  local branch
  printf '\n==> The release failed at "%s". Going back to %s\n' "$STAGE" "$(git rev-parse --short "$ROLLBACK_TO")" >&2
  branch="$(git rev-parse --abbrev-ref HEAD)"
  # Moves the branch back without discarding anything: it refuses if a tracked file was edited here.
  git checkout -q -B "$branch" "$ROLLBACK_TO" || { echo "Could not switch back (local edits in the way). The site may be down: see docs/DEPLOY-VPS.md, Rolling back." >&2; return 1; }
  npm ci && npm run build || { echo "The previous version did not build. The site may be down: see docs/DEPLOY-VPS.md, Rolling back." >&2; return 1; }
  restart_api || { echo "PM2 did not restart the previous version. Look at: pm2 logs alaeh-stocks --lines 50" >&2; return 1; }
  if wait_for_api; then
    printf '\nROLLED BACK: the site is running the previous version again (%s). The new release was NOT deployed.\n' "$(git log --oneline -1)" >&2
  else
    echo "Went back to the previous version, but the API still does not answer. Look at: pm2 logs alaeh-stocks --lines 50" >&2
    return 1
  fi
}

# Runs whenever the script ends. A failure after the code changed is where going back happens.
on_exit() {
  local code=$?
  trap - EXIT
  set +e
  if [[ $code -ne 0 && -n "$ROLLBACK_TO" ]]; then
    if [[ -n "$HAS_MIGRATIONS" && "$STAGE" != "install" && "$STAGE" != "build" ]]; then
      cat >&2 <<EOF

NOT going back automatically: this release has database migrations and failed at "$STAGE", so the
database may already be changed. Decide by hand (docs/DEPLOY-VPS.md, Rolling back):
  - fix forward: look at  pm2 logs alaeh-stocks --lines 50  , fix, and deploy again; or
  - go back:  git reset --hard $(git rev-parse --short "$ROLLBACK_TO") && npm ci && npm run build && pm2 restart alaeh-stocks
    and, if the old code cannot run on the migrated database, restore the snapshot this deploy took.
EOF
    else
      roll_back
    fi
  fi
  exit "$code"
}

main() {
  cd "$APP_DIR"
  [[ "$(id -u)" -ne 0 ]] || die "Do not run this as root. Use the normal user that owns $APP_DIR and runs PM2."
  [[ -f server/.env ]] || die "server/.env is missing. Create it first (docs/DEPLOY-VPS.md, step 5)."
  command -v pm2 >/dev/null || die "pm2 is not installed (sudo npm install -g pm2)."

  local previous
  if [[ -n "${ALAEH_DEPLOY_PREVIOUS:-}" ]]; then
    # Second pass (see below): the code is already updated.
    previous="$ALAEH_DEPLOY_PREVIOUS"
  else
    previous="$(git rev-parse HEAD)"
    update_code "${1:-}"
    # The update may have replaced this very script. Start the new copy for the rest, so a fix to
    # the deploy steps applies to the release that brings it, not to the one after.
    if ! git diff --quiet "$previous" HEAD -- deploy/vps/deploy.sh; then
      echo "deploy.sh itself changed: continuing with the new copy"
      ALAEH_DEPLOY_PREVIOUS="$previous" exec bash "$SELF"
    fi
  fi

  if [[ "$previous" != "$(git rev-parse HEAD)" ]]; then
    ROLLBACK_TO="$previous"
    git diff --quiet "$previous" HEAD -- server/prisma || HAS_MIGRATIONS=1
  fi
  trap on_exit EXIT

  STAGE="install"
  step "Installing dependencies"
  npm ci

  STAGE="build"
  step "Building (API and client)"
  npm run build

  STAGE="migrate"
  step "Migrating the database (snapshot first)"
  npm run db:migrate:deploy

  STAGE="restart"
  step "Restarting the API"
  restart_api

  STAGE="health check"
  step "Waiting for the API to answer on port $API_PORT"
  wait_for_api || die "The API did not answer. Look at: pm2 logs alaeh-stocks --lines 50"

  ROLLBACK_TO=""
  printf '\nDeployed OK (%s)\n' "$(git log --oneline -1)"
  printf 'Check it in the browser, and if .env.example gained new variables, add them to server/.env.\n'
}

# Everything above is read before anything runs, so replacing this file mid-deploy cannot change
# the steps of a run that has already started.
main "$@"
