# Ala Eh Food Products — Online & Offline Stocks Monitoring System

A web-based replacement for the manual Excel stock-monitoring workbook used by the Online and
Offline monitoring encoders. Implements the plan in
`Ala_Eh_Stocks_Monitoring_System_Documentation-now.pdf` (v1.1 — revised stack).

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
services depending on each other).

## Getting started

### 1. Database

Create a MySQL database and copy the env file:

```bash
cd server
cp .env.example .env
# edit .env with your DATABASE_URL and JWT_SECRET
```

### 2. Server

```bash
cd server
npm install
npx prisma migrate dev --name init
npm run seed      # loads the product master list (Section 4.1) + a default admin user
npm run dev        # http://localhost:4000
```

Default seeded admin login: `admin` / `admin123` (change immediately — see `prisma/seed.ts`).

### 3. Client

```bash
cd client
npm install
npm run dev         # http://localhost:5173
```

The client expects the API at `VITE_API_URL` (defaults to `http://localhost:4000/api`,
see `client/.env.example`).

## What's implemented (Phases 1–4 of Section 9)

- Product & category master list (Section 4.1), admin-managed.
- Daily Online / Offline stock entry grids with auto carry-forward of opening stock (Section 4.6).
- Auto-mirrored Online↔Offline transfer figures (Section 4.3 "key change from Excel").
- Server-calculated subtotal / Remaining Stock columns — never client-editable (Section 3.1).
- Manual Counting & system-calculated Variance (Section 4.4).
- Live Total Stocks view (Online + Offline, Section 4.5).
- Receipt / Sales Order entry with optional auto-post into Fulfillment (Out) (Section 4.7).
- Daily Report, Variance Report, and an auditable Change Log (Section 4.8).
- Role-based access: Online Encoder / Offline Encoder / Supervisor-Admin (Section 3.2).

Phase 5 (encoder training / parallel run / cutover) is a rollout activity outside the codebase.
