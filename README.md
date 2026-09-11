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
# edit .env - set DATABASE_URL and a random JWT_SECRET
# XAMPP default: mysql://root:@localhost:3306/ala_eh_stocks (no password)
```

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
  sides without duplicate typing.
- Server-calculated subtotal / Remaining Stock columns — never client-editable.
- Manual Counting & system-calculated Variance (Section 4.4), flagged rows for non-zero variance.
- Live Total Stocks view (Online + Offline, Section 4.5), always in sync by construction.
- Receipt / Sales Order entry (Section 4.7): the entry form itself is styled as an editable
  physical receipt, with a live preview beside it showing exactly what Save will produce, and can
  post straight into that date's Fulfillment (Out).
- Daily Report, Variance Report, and a Change Log page (Section 4.8) — every create/update/delete
  across the app, attributed and timestamped, with an expandable before/after diff per entry.
- Role-based access: Online Encoder / Offline Encoder / Supervisor-Admin (Section 3.2).

**Data entry & reporting tools**
- Excel-style zoom (25%–200%) on every grid page and the Receipts page — genuinely re-lays-out
  text/cells/inputs at the new scale (CSS `zoom`, not a visual stretch).
- CSV export/import on Online Entry, Offline Entry, Total Stocks, and Manual Count, for bulk
  correction via a spreadsheet (Section 3.1) — import only ever applies fields that actually
  changed, so a round-tripped export doesn't resubmit 60 unchanged rows as edits.
- One-file, multi-section CSV export on the Daily Report (Online + Offline + Total in a single
  download).
- Export as PDF via the browser's print dialog on every grid page (choose "Save as PDF").
- Smart multi-term search on every toolbar (product/category, or customer/location/product for
  Receipts).

**Under the hood**
- Batched opening-stock and system-remaining-stock lookups (2 queries instead of one per product)
  to avoid an N+1 query pattern on grid loads.
- In-memory, write-invalidated caching for the product master list.
- Independently-scrolling sidebar and content pane, so a long grid never drags the sidebar (and
  its Log out button) down with it.

Phase 5 (encoder training / parallel run / cutover) is a rollout activity outside the codebase.
