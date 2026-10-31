# Ala Eh Food Products — Online & Offline Stocks Monitoring System

A web-based replacement for the manual Excel stock-monitoring workbook used by the Online and
Offline monitoring encoders. Implements the plan in
`Ala_Eh_Stocks_Monitoring_System_Documentation-now.pdf` (v1.1 — revised stack), styled with the
Ala Eh! Food Products brand (black/gold seal, red banner, "Ala Eh!" wordmark).

Stack: **React + TypeScript** (client) · **Express + TypeScript** (server) · **MySQL** via **Prisma**.

## Layout

```
server/   Express + TypeScript REST API, Prisma schema, business logic
client/   React + TypeScript SPA (spreadsheet-style entry grids)
```

The server is a classic layered (MVC-style) app: `routes/ → controllers/ →
services/ → repositories/ → Prisma`. See [`server/ARCHITECTURE.md`](server/ARCHITECTURE.md)
for the full breakdown, the dependency rule between layers, and why the
business logic is organized the way it is (in particular, how the Section 4.3
Online↔Offline transfer mirroring is implemented without the two stock
services depending on each other, or creating a change-log entry when nothing
about the transfer actually changed).

## Getting started

### 1. Database

Any MySQL-compatible server works; on Windows the recommended setup is MySQL Server 8.4 plus
MySQL Workbench (`winget install Oracle.MySQL Oracle.MySQLWorkbench`; set the root password in
the MySQL configurator). Create a database and a dedicated account for the app - the app
should never connect as `root`, which can read and change every database on the server.
Run this once as root (in MySQL Workbench or the `mysql` client), with your own password:

```sql
CREATE DATABASE IF NOT EXISTS ala_eh_stocks CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'alaeh_app'@'localhost' IDENTIFIED BY 'a-long-random-password';
GRANT ALL PRIVILEGES ON ala_eh_stocks.* TO 'alaeh_app'@'localhost';
```

`ALL PRIVILEGES ON ala_eh_stocks.*` covers what the app, its migrations and its backups
need (`prisma migrate deploy` runs DDL; `mysqldump` reads tables, views, triggers and
routines) and nothing outside that one database. Then copy the server's env file:

```bash
cd server
cp .env.example .env
# edit .env - set DATABASE_URL, JWT_SECRET, and DATA_RESET_PASSCODE - the
# server refuses to start if any of these are missing, with no insecure
# fallback.
# e.g. mysql://alaeh_app:YOUR_APP_PASSWORD@localhost:3306/ala_eh_stocks
```

`JWT_SECRET` and `DATA_RESET_PASSCODE` both need a real random value —
generate one for each with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Placeholder values (e.g. leaving `JWT_SECRET` as the literal string from
`.env.example`, or reusing an old hardcoded default like `127001`) are
rejected at boot too, with the same "no insecure fallback" reasoning —
see `server/src/config/env.ts`.

#### Environment variables

| Variable | Where | Required? | Purpose |
|---|---|---|---|
| `DATABASE_URL` | server | required | MySQL connection string |
| `JWT_SECRET` | server | required, no placeholder | Signs/verifies login JWTs |
| `DATA_RESET_PASSCODE` | server | required, no placeholder | Gates the Data Reset admin panel |
| `PORT` | server | optional (default `4000`) | API listen port |
| `HOST` | server | optional (default `127.0.0.1`) | API bind address; keep loopback behind Caddy |
| `JWT_EXPIRES_IN` | server | optional (default `8h`) | Login session lifetime |
| `CLIENT_ORIGIN` | server | optional (default `http://localhost:5173`) | Allowed CORS origin |
| `NODE_ENV` | server | optional (default `development`) | `production` in a real deployment — see [Production deployment](#4-production-deployment) |
| `VITE_API_URL` | client | optional (default `/api`) | Same-origin API base URL; Vite proxies it in development and Caddy proxies it in production |

### 2. Install, migrate, seed

```bash
cd server
npm install                          # also runs `prisma generate` automatically
npx prisma migrate dev --name init   # creates the schema (Section 5)
npm run seed                         # loads the product master list (Section 4.1) + default logins
```

```bash
cd client
cp .env.example .env
npm install
```

### 3. Run it

From the repository root, start both the API and web client:

```bash
npm run dev
```

- API: `http://localhost:4000`
- Client: `http://localhost:5173`

You can also start either service separately with `npm run dev:server` or
`npm run dev:client`.

**Same-origin API:** the client defaults to `/api`; Vite proxies `/api`, `/health`,
and `/ws` to the local API during development. Production uses the same paths
through Caddy, so browser clients do not need a hardcoded server IP or
cross-origin API address.

### 4. Production deployment

The web server is **Caddy** ([`deploy/caddy/Caddyfile`](deploy/caddy/Caddyfile)): it serves
the built client, proxies `/api`, `/health` and the `/ws` WebSocket to the API, and gets
and renews the HTTPS certificate by itself. Shared hosting is not suitable for the
continuously running API and realtime WebSocket.

**Docker:** `docker compose up -d --build` serves plain HTTP on `http://localhost:8080`.
For a real address, point a domain at the server, open ports 80 and 443, and set in `.env`:
`SITE_ADDRESS=stocks.example.com`, `CLIENT_ORIGIN=https://stocks.example.com`,
`HTTP_PORT=80`, `HTTPS_PORT=443`. Nothing else to configure.

**Keeping your data safe when updating (Docker):**
- Your data lives in the `db_data` volume. `git pull` and `docker compose up -d --build` never touch it.
  **Never run `docker compose down -v`** (or delete the volume in Docker Desktop): that erases the database.
- Updates run the database migrations automatically on start, and the API takes a snapshot first
  (`api_backups` volume). If that snapshot fails, the migration does not run.
- Before any update, and on a schedule, take your own backup outside Docker:
  `npm run backup:docker` writes a verified `.sql.gz` to `C:\ala-eh-backups\docker` (set `DOCKER_BACKUP_DIR` to change it;
  the newest 30 are kept). To schedule it daily on Windows:
  `schtasks /Create /SC DAILY /ST 02:00 /TN "Ala Eh docker backup" /TR "cmd /c cd /d C:\path\to\project && npm run backup:docker"`.
- Check a backup actually loads, without touching live data:
  `npm run restore:docker -- --file <backup.sql.gz> --database scratch_check --yes`, then drop `scratch_check`.
- Real restore: `npm run restore:docker -- --file <backup.sql.gz> --yes` (takes a safety backup first), then `docker compose restart api`.
- Copy the backup folder to another disk or a cloud drive now and then: a backup on the same disk does not survive the disk.
- Keep `.env` safe too (passwords, `JWT_SECRET`, `DRIVE_TOKEN_KEY`): it is not in git, and without `DRIVE_TOKEN_KEY` / `JWT_SECRET` you must reconnect Drive and log everyone in again.

**VPS without Docker (PM2 + Nginx or Caddy):** the complete step-by-step is in [`docs/DEPLOY-VPS.md`](docs/DEPLOY-VPS.md) (Ubuntu 24.04, Nginx, PM2, MySQL on the host, HTTPS, backups, updates). The Nginx site is `deploy/nginx/ala-eh.conf` and updates are one command: `bash deploy/vps/deploy.sh`. To use Caddy instead, build the client (`npm run build --workspace client`), copy `client/dist` to `/var/www/ala-eh/client/dist`, run the API with PM2 (`ecosystem.config.cjs`), then run Caddy with the same Caddyfile and: `SITE_ADDRESS=stocks.example.com SITE_ROOT=/var/www/ala-eh/client/dist API_UPSTREAM=127.0.0.1:4000 caddy run --config deploy/caddy/Caddyfile`. Either way set `CLIENT_ORIGIN` in `server/.env` to `https://stocks.example.com`.

### 5. Tests & linting

```bash
npm run test    # runs both workspaces' Vitest suites
npm run lint    # one shared ESLint flat config (eslint.config.mjs) for server + client
```

### First logins (seeded)

`npm run seed` creates two accounts: `admin` (Admin) and `encoder` (Encoder).
There are no fixed default passwords: each is taken from `SEED_ADMIN_PASSWORD` / `SEED_ENCODER_PASSWORD`
if set, otherwise a random one is generated and printed once at the end of the seed.
Whichever it was, each account must choose its own password (10+ characters, nothing common) the first time it signs in.
Administrators should then turn on two-step verification under Settings > My Account.

**Someone forgot their password?** There is no email in this system. An administrator opens Settings > User Passwords, clicks **Reset code** for that person and gives them the code (one use, 30 minutes). The person clicks **Forgot password?** on the login page and enters their username, the code and a new password. If nobody can sign in as an administrator (the only admin forgot their password), run this on the server: `docker compose exec api node dist/cli/resetPassword.js <username>` (it asks for the new password; their other sessions are signed out and they choose their own at next sign-in). If that admin also lost their phone, `docker compose exec api node dist/cli/resetMfa.js <username>` turns two-step off. Without Docker, use `npm run reset-password` / `npm run reset-mfa` in `server/`. It is a good idea to keep two administrator accounts.

## Features

**Core monitoring (Sections 3–5 of the plan)**
- Product & category master list (Section 4.1), admin-managed, cached server-side and
  invalidated on write.
- Daily Online / Offline stock entry grids with auto carry-forward of opening stock (Section 4.6),
  category grouping, and subtotal/grand-total rows — an Excel-like editable grid (Section 3.1). A
  period's opening stock normally carries forward from the immediately preceding period's own
  Remaining Stock, but if that period also has a saved Online/Offline manual count (Section 4.4),
  the physical count supersedes it instead — the correction, not the pre-correction figure, is what
  the next period actually starts from. Only ever the one period being carried forward from. A
  count published with "use as next day's opening" (a re-audit) DOES reach later days already
  saved: their entries are kept and only their opening, and the remaining that follows, are
  recalculated; a finished day is held for an admin's approval instead, and an imported opening
  stays. Editing an already-applied count takes it back to unpublished, which puts later days
  back on the carried-forward figure until it is published again. A
  combined Total-location count stays purely informational (Variance Report / Consolidated) since
  it can't be unambiguously split back between the two pools.
- Auto-mirrored Online↔Offline transfer figures (Section 4.3), written once and reflected on both
  sides without duplicate typing. A Stock Out (Fulfillment/Delivery, or a transfer to the other
  channel) may be saved before the In that covers it, so Remaining Stock can go negative on a
  sheet that is still open. Nothing is hidden: the row is flagged, the Admin Queue lists the open
  sheet, and Finish Day refuses to lock it for an encoder. A supervisor/admin can finish with a
  written reason, which is recorded in the Change Log (`negative_stock_signoff`).
- Server-calculated subtotal / Remaining Stock columns — never client-editable.
- Manual Counting & system-calculated Variance (Section 4.4), flagged rows for non-zero variance.
- Realtime sync: a shared WebSocket connection tells every open page to refresh the moment any
  encoder saves an entry, manual count, or runs a data reset — no manual reload needed to see
  another encoder's work.
- Live Consolidated view (Section 4.5; the page was called Total Stocks). Online and Offline are separate stock pools that aren't
  expected to tally with each other — every report (Consolidated, Daily Report, Dashboard, Monthly
  Monitoring) shows both channels separately, with a combined "Total" kept alongside them only as
  an explicitly-labeled figure, never the only number shown.
- Daily Report, Variance Report, and a Change Log page (Section 4.8) — every create/update/delete
  across the app, attributed and timestamped, with an expandable before/after diff per entry.
- Dashboard with a today-at-a-glance stat row and a Monthly Monitoring section: a year-at-a-glance
  Online/Offline trend chart plus variance-flag counts per month.
- Settings page (Supervisor-Admin): a full `mysqldump` database backup, streamed straight to a
  browser download with a live byte counter, and the passcode-gated Data Reset panel for wiping
  transactional data between test runs or a new rollout period.
- Role-based access: Encoder (enters stock on both grids, requests corrections) / Admin (approvals, releases, reports, setup).

**Data entry & reporting tools**
- Excel-style zoom (25%–200%) on every grid page — genuinely re-lays-out text/cells/inputs at the
  new scale (CSS `zoom`, not a visual stretch).
- CSV export on Online Entry, Offline Entry, Consolidated, and Manual Count (Section 3.1). Import
  (Online/Offline Entry only) writes just Opening Stock, read from the file's Remaining Stock/
  ending-balance column (or its own Opening Stock column, for a day with no prior balance to carry
  forward) — every other cell starts at 0 each day and is entered fresh, so import never applies a
  file's old Stock In/Out, Production, delivery, Upsell, or Backload figures onto a different day.
- One-file, multi-section CSV export on the Daily Report (Online + Offline + Total in a single
  download).
- Export as a real generated PDF (not the browser's print dialog) on every grid page — one fixed
  page format, the same brand chrome (masthead, category bars, page-X-of-Y footer) every time,
  built from the same row data the CSV/Excel export uses.
- Smart multi-term search on every toolbar (product/category).

**Security**
- `helmet` security headers on every API response; a strict Content-Security-Policy is injected
  into the client's production build only (never the dev server/HMR).
- Rate limiting: a generous backstop across the whole API, plus a tight brute-force limit on login
  and the Data Reset passcode check specifically.
- `JWT_SECRET` / `DATA_RESET_PASSCODE` are both required env vars with no insecure fallback — the
  server refuses to boot rather than running on a guessable default.
- zod request validation on every controller that takes user input; a top-level React error
  boundary so an uncaught render error never white-screens the whole app.

**Under the hood**
- Batched opening-stock and system-remaining-stock lookups (2 queries instead of one per product)
  to avoid an N+1 query pattern on grid loads.
- In-memory, write-invalidated caching for the product master list.
- Independently-scrolling sidebar and content pane, so a long grid never drags the sidebar (and
  its Log out button) down with it.
- Skeleton screens (not spinners) on every data-dependent page, and a determinate top-of-viewport
  progress bar for exports/imports and the database backup download — bound to real progress
  (rows imported, bytes downloaded) where that data exists, an eased "still working" fallback
  where it doesn't.
- Route-level code-splitting plus dynamically-imported PDF libraries (only fetched when a PDF is
  actually generated) — cut the client's main bundle from ~918KB to ~333KB.
- `eslint.config.mjs` (one shared flat config for both workspaces) + Vitest unit tests on the
  highest logic-density modules (stock math, shift/date boundary logic).

Phase 5 (encoder training / parallel run / cutover) is a rollout activity outside the codebase.
