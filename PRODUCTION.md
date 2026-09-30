# Running this in production (pm2 + ngrok)

This app's real deployment is still XAMPP's MySQL + an ngrok tunnel (see [`NGROK_SETUP.md`](NGROK_SETUP.md)
for the day-to-day "re-tunnel after an XAMPP reset" workflow) — this doc covers making that setup
production-grade instead of running dev-mode watchers under a plain terminal: process management
that survives a crash or a reboot, production builds instead of `tsx watch`/Vite's dev server, and
a tunnel URL that doesn't change every time it's restarted.

## 1. Apply database migrations

Run this from the repo root on every deployment that contains a new or changed
folder under `server/prisma/migrations`. `prisma migrate deploy` is the
production-safe command: it applies only migrations that are not already
recorded in the database and does not create or rewrite migrations.

Take a backup before applying a migration, especially when the migration drops
or changes columns/tables:

```bash
npm run backup:snapshot
npm run db:migrate:deploy
```

If the command reports a failed migration, stop the deployment and restore or
repair the database before restarting the API. Do not use `prisma migrate dev`
against the production database.

## 2. Build

From the repo root:

```bash
npm run build
```

This runs `prisma generate && tsc` for the server and `tsc -b && vite build` for the client
(unchanged, existing root script) — producing `server/dist` and `client/dist`.

## 3. Environment

Copy `server/.env.example` → `server/.env` on the production machine and fill in real values —
same requirements as dev (`DATABASE_URL`, `JWT_SECRET`, `DATA_RESET_PASSCODE`, no placeholder
values, see `server/src/config/env.ts`), plus:

- `NODE_ENV="production"`
- `CLIENT_ORIGIN` set to your reserved ngrok domain (step 4) instead of the `localhost:5173`
  default, so CORS is scoped to the real production URL.

`client/.env` should keep `VITE_API_URL=/api` (relative), same as the ngrok dev setup in
`NGROK_SETUP.md` — this is what lets the client, API, and realtime WebSocket all ride through one
tunnel origin.

## 4. Process management (pm2)

Install pm2 globally once (`npm install -g pm2`), then from the repo root:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # prints a command to run once, so pm2 restarts everything on machine reboot
```

`ecosystem.config.cjs` runs two processes, restarting either automatically if it crashes:

- **`ala-eh-api`** — the built server (`node server/dist/server.js`).
- **`ala-eh-client`** — `vite preview` serving the built client, still proxying `/api` and the
  realtime `/ws` upgrade to the API on the same origin (`client/vite.config.ts`'s `preview.proxy` —
  the production equivalent of the dev `server.proxy` `NGROK_SETUP.md` already relies on).

Useful commands: `pm2 status`, `pm2 logs`, `pm2 restart ala-eh-api` (e.g. after deploying a new
build — repeat steps 1–2, then restart both apps).

## 5. Tunnel

```bash
ngrok http --url=<your-reserved-domain> 5173
```

Tunnel the **client's** port (5173, where `vite preview` and its proxy live) — same single-origin
shape as the dev workflow, just pointed at production builds.

Use a **paid ngrok reserved domain** here rather than a free random one: a production URL that
changes on every restart isn't something you can actually hand out. `NGROK_SETUP.md` covers this as
an aside for dev; here it's the primary recommendation.

## Realtime sync

Nothing extra to configure — the WebSocket connection (`client/src/context/RealtimeContext.tsx`)
derives its URL from the same `VITE_API_URL` the REST calls use, and rides through the same
`vite preview` proxy and ngrok tunnel as everything else.

## Backups (nightly, local, with retention)

The app has no user-uploaded files - everything lives in MySQL - so backups are database-only. The
Settings > Backup & Restore page covers on-demand backups; these scripts add the unattended,
scheduled kind. They read `DATABASE_URL` (and `MYSQLDUMP_PATH`) from `server/.env`, so there are no
credentials to duplicate. Backups go to `C:\ala-eh-backups` (override with the `BACKUP_DIR` env var -
ideally a different physical disk than the database).

```powershell
# One-time, from an elevated PowerShell: nightly run at 02:00 (catches up if the PC was off)
powershell -ExecutionPolicy Bypass -File scripts\install-backup-task.ps1

npm run backup            # take a daily-style backup now
npm run backup:snapshot   # instant snapshot - run BEFORE prisma migrate / deploying an update
npm run restore -- -List  # list backups
npm run restore -- -File C:\ala-eh-backups\daily\db_backup_2026-09-30_020000.sql.gz
```

- **Format / naming:** `db_backup_YYYY-MM-DD_HHmmss.sql.gz`, written to `*.partial` first and only
  renamed after the whole file has been decompressed and checked for mysqldump's completion marker,
  so a half-written dump is never kept as a "good" backup.
- **Retention:** `daily\` keeps 7 days (`-RetentionDays`; the newest file is never deleted).
  `snapshots\` keeps the newest 10 and is never touched by the daily purge.
- **Safety checks:** refuses to run with less than 500 MB free (or 3x the last dump); exit code 1 and
  an `[ERROR]` line on any failure. Everything is logged to `<BackupDir>\backup.log`.
- **Permissions:** the backup folder is restricted to your account, SYSTEM and Administrators (it
  holds every account and all stock data). The DB password travels via `MYSQL_PWD` to the child
  process only, never on a command line. `server/.env` is deliberately *not* backed up alongside the
  dumps - keep that secret somewhere separate.
- **Restore:** stop the API first (`pm2 stop ala-eh-api`), run the restore command above (it verifies
  the file, takes a `pre-restore` snapshot of the current data, and makes you type `RESTORE`), then
  `pm2 start ala-eh-api`. Add `-Database some_scratch_db` to rehearse a restore without touching live
  data. If the task logs `server\.env not found`, register it under your own account instead of SYSTEM.
- **Copies off the machine:** these are same-machine backups - a dead disk or a stolen PC takes them
  too. Periodically copy the folder to another drive or cloud storage.
