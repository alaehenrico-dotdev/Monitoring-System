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

Any MySQL-compatible server works, including XAMPP's bundled MariaDB. Create a database, then
copy the server's env file:

```bash
cd server
cp .env.example .env
# edit .env - set DATABASE_URL, JWT_SECRET, DATA_RESET_PASSCODE, and
# RECEIPT_QR_SECRET (see below) - the server refuses to start if any of
# these are missing, with no insecure fallback.
# XAMPP default: mysql://root:@localhost:3306/ala_eh_stocks (no password)
```

`JWT_SECRET`, `DATA_RESET_PASSCODE`, and `RECEIPT_QR_SECRET` all need a real
random value — generate one for each with:

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
| `RECEIPT_QR_SECRET` | server | required, no placeholder | Encrypts the id in a printed receipt's QR code |
| `PORT` | server | optional (default `4000`) | API listen port |
| `JWT_EXPIRES_IN` | server | optional (default `8h`) | Login session lifetime |
| `CLIENT_ORIGIN` | server | optional (default `http://localhost:5173`) | Allowed CORS origin |
| `RECEIPTS_AUTO_POST_DEFAULT` | server | optional (default `true`) | Whether saving a Receipt auto-posts into Online Fulfillment (Out) |
| `VITE_API_URL` | client | optional (default `http://localhost:4000/api`) | API base URL the client calls directly, in both dev and production (see the dev proxy note below) |

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

From the repo root, one command starts both the API and the client together (labeled, color-coded
output; `Ctrl+C` stops both):

```bash
npm run dev
```

- API: `http://localhost:4000`
- Client: `http://localhost:5173`

(`npm run dev:server` / `npm run dev:client` from the root, or `npm run dev` from inside `server/`
or `client/` directly, still work individually if you want them in separate terminals.)

**Dev proxy:** by default (`VITE_API_URL` unset or left at its `.env.example` value), the client
calls the API's absolute URL directly (`http://localhost:4000/api`) — the server's `CLIENT_ORIGIN`
CORS setting is what allows that cross-port call from `:5173`. `client/vite.config.ts` also
configures Vite's dev server to proxy `/api/*` to `http://localhost:4000` (`server.proxy` in that
file); that path is only actually used if `VITE_API_URL` is set to a relative `/api` instead of the
absolute URL, which the default setup above doesn't do — it's there for setups (e.g. behind an
ngrok tunnel, see `allowedHosts` in the same config block) where hitting the API through the same
origin as the client is preferable to a direct cross-origin call.

### 4. Tests & linting

```bash
npm run test    # runs both workspaces' Vitest suites
npm run lint    # one shared ESLint flat config (eslint.config.mjs) for server + client
```

### Default logins (seeded — change before real use)

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Supervisor-Admin — sees every page |
| `online.encoder` | `online123` | Online Encoder |
| `offline.encoder` | `offline123` | Offline Encoder |

## Features

**Core monitoring (Sections 3–5 of the plan)**
- Product & category master list (Section 4.1), admin-managed, cached server-side and
  invalidated on write.
- Daily Online / Offline stock entry grids with auto carry-forward of opening stock (Section 4.6),
  category grouping, and subtotal/grand-total rows — an Excel-like editable grid (Section 3.1).
- Auto-mirrored Online↔Offline transfer figures (Section 4.3), written once and reflected on both
  sides without duplicate typing. A Stock Out (Fulfillment/Delivery, or a transfer to the other
  channel) that would take a channel's Remaining Stock below zero is rejected server-side, on
  either side of the transfer, rather than silently persisted as a negative balance.
- Server-calculated subtotal / Remaining Stock columns — never client-editable.
- Manual Counting & system-calculated Variance (Section 4.4), flagged rows for non-zero variance.
- Live Total Stocks view (Section 4.5). Online and Offline are separate stock pools that aren't
  expected to tally with each other — every report (Total Stocks, Daily Report, Dashboard, Monthly
  Monitoring) shows both channels separately, with a combined "Total" kept alongside them only as
  an explicitly-labeled figure, never the only number shown.
- Receipt / Sales Order entry (Section 4.7): the entry form itself is styled as an editable
  physical receipt, with a live preview beside it showing exactly what Save will produce, and can
  post straight into that date's Fulfillment (Out). The printed receipt's QR code encodes an
  AES-256-GCM-encrypted token, not the plain receipt id — the one id in the app that actually
  leaves the authenticated app, onto paper anyone can scan.
- Daily Report, Variance Report, and a Change Log page (Section 4.8) — every create/update/delete
  across the app, attributed and timestamped, with an expandable before/after diff per entry.
- Dashboard with a today-at-a-glance stat row and a Monthly Monitoring section: a year-at-a-glance
  Online/Offline trend chart plus receipts and variance-flag counts per month.
- Settings page (Supervisor-Admin): a full `mysqldump` database backup, streamed straight to a
  browser download with a live byte counter, and the passcode-gated Data Reset panel for wiping
  transactional data between test runs or a new rollout period.
- Role-based access: Online Encoder / Offline Encoder / Supervisor-Admin (Section 3.2).

**Data entry & reporting tools**
- Excel-style zoom (25%–200%) on every grid page and the Receipts page — genuinely re-lays-out
  text/cells/inputs at the new scale (CSS `zoom`, not a visual stretch).
- CSV export/import on Online Entry, Offline Entry, Total Stocks, and Manual Count, for bulk
  correction via a spreadsheet (Section 3.1) — import only ever applies fields that actually
  changed, so a round-tripped export doesn't resubmit 60 unchanged rows as edits.
- One-file, multi-section CSV export on the Daily Report (Online + Offline + Total in a single
  download).
- Export as a real generated PDF (not the browser's print dialog) on every grid page and the
  receipt review modal — one fixed page format, the same brand chrome (masthead, category bars,
  page-X-of-Y footer) every time, built from the same row data the CSV/Excel export uses.
- Smart multi-term search on every toolbar (product/category, or customer/location/product for
  Receipts).

**Security**
- `helmet` security headers on every API response; a strict Content-Security-Policy is injected
  into the client's production build only (never the dev server/HMR).
- Rate limiting: a generous backstop across the whole API, plus a tight brute-force limit on login
  and the Data Reset passcode check specifically.
- `JWT_SECRET` / `DATA_RESET_PASSCODE` / `RECEIPT_QR_SECRET` are all required env vars with no
  insecure fallback — the server refuses to boot rather than running on a guessable default.
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
- Route-level code-splitting plus dynamically-imported PDF/QR libraries (only fetched when a PDF
  is actually generated) — cut the client's main bundle from ~918KB to ~333KB.
- `eslint.config.mjs` (one shared flat config for both workspaces) + Vitest unit tests on the
  highest logic-density modules (stock math, shift/date boundary logic, the receipt QR cipher).

Phase 5 (encoder training / parallel run / cutover) is a rollout activity outside the codebase.
