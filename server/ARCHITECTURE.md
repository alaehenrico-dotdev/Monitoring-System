# Server Architecture

Classic layered (MVC-style) Express + TypeScript backend. Every request flows
through the same four layers, in the same direction:

```
HTTP request
     │
     ▼
┌─────────────┐   Express Router: path + HTTP verb + auth/role guards.
│   routes/   │   No business logic - wires a URL to a controller function.
└──────┬──────┘
       ▼
┌─────────────┐   Parses/validates req.body & req.query (zod), calls one
│ controllers/│   service function, shapes the HTTP response (status + JSON).
└──────┬──────┘   No business logic, no direct Prisma access.
       ▼
┌─────────────┐   All business rules: carry-forward, Online<->Offline
│  services/  │   mirroring, variance calculation, change-log writes,
└──────┬──────┘   report composition. Talks to repositories, never to
       ▼          Prisma directly, and never to Express types (req/res).
┌─────────────┐   One file per Prisma model. Every prisma.* call in the
│repositories/│   codebase lives here. Pure data access - no business rules.
└──────┬──────┘
       ▼
┌─────────────┐
│    MySQL    │   via Prisma Client (server/prisma/schema.prisma)
└─────────────┘
```

Cross-cutting folders that any layer can use:

```
config/     env.ts               - reads/validates process.env once
lib/        prisma.ts            - the single shared PrismaClient instance
middleware/ auth.ts               - authenticate() / authorize(...roles)
            errorHandler.ts       - HttpError -> HTTP response, 404 fallback
utils/      HttpError.ts, asyncHandler.ts, jwt.ts, date.ts
            stockMath.ts          - pure calculation formulas (see below)
types/      express.d.ts          - augments Express's Request with req.user
```

## Dependency rule

Each layer may only depend on the layer(s) below it:

```
routes  ──depends on──▶  controllers  ──depends on──▶  services  ──depends on──▶  repositories  ──depends on──▶  Prisma
```

- A **repository never imports a service** (data access doesn't know about business rules).
- A **service never imports Express types** (`Request`/`Response`) - that keeps
  business logic testable without spinning up HTTP.
- A **service may import another service**, but only in one direction - see below.

## Why this replaced the earlier feature-folder layout

The project originally grouped code by feature (`modules/dailyOnlineStock/`,
`modules/dailyOfflineStock/`, ...), each with its own routes/controller/service.
That worked, but `dailyOnlineStock.service.ts` and `dailyOfflineStock.service.ts`
imported each other directly to implement the Section 4.3 transfer-mirroring
rule ("a transfer entered once here appears automatically on the other side") -
a circular dependency between two service modules.

Moving to layer-first folders made the fix natural: both stock services now
depend **downward only**, on `dailyOnlineStockRepository` and
`dailyOfflineStockRepository`, never on each other:

```
dailyOnlineStock.service.ts  ──▶  dailyOnlineStockRepository   ┐
        │                                                      ├─ no cycle
        └────────────────────▶  dailyOfflineStockRepository   ┘

dailyOfflineStock.service.ts ──▶  dailyOfflineStockRepository  ┐
        │                                                      ├─ no cycle
        └────────────────────▶  dailyOnlineStockRepository    ┘
```

When the Online service saves a transfer, it writes the mirrored fields onto
the Offline table *by calling the Offline repository directly* (see
`mirrorTransferToOffline` in `dailyOnlineStock.service.ts`), recomputing that
row's totals itself via the shared, dependency-free `utils/stockMath.ts`
formulas. The Offline service does the reverse. Neither service is aware the
other exists.

## Legitimate service→service dependencies

A few services do call other services - always one-directional, so there's
still no cycle:

| Caller | Calls | Why |
|---|---|---|
| `receipts.service.ts` | `dailyOnlineStock.service.ts` (`addFulfillmentFromReceipt`) | Section 4.7: a saved receipt can post into that date's Fulfillment (Out). |
| `reports.service.ts` | `dailyOnlineStock`, `dailyOfflineStock`, `totalStocks`, `manualCounts` services | Section 4.8: the Daily/Variance Report is a read-only composition of the other grids - it holds no calculation logic of its own. |
| `products.service.ts`, `dailyOnlineStock.service.ts`, `dailyOfflineStock.service.ts`, `manualCounts.service.ts`, `receipts.service.ts` | `changeLog.service.ts` | Section 4.8: every create/update is logged. `changeLog.service.ts` itself depends on nothing but its own repository, so it can never be part of a cycle. |

`totalStocks.service.ts` calls no other service at all - it reads three
repositories directly and combines the results, matching Section 4.5's "not a
manually-entered table, just a calculated view."

## `utils/stockMath.ts`

The Section 4.2-4.4 formulas (Online/Offline subtotal, Remaining Stock,
Variance) are pure functions with no Prisma or Express imports, so both stock
services - and anything mirroring between them - use the exact same math
instead of each maintaining its own copy.

## Adding a new feature

1. `repositories/xRepository.ts` - the Prisma queries this feature needs.
2. `services/x.service.ts` - business rules, calling only repositories (and,
   if genuinely needed, one other service - never circularly).
3. `controllers/x.controller.ts` - validate input, call the service, shape the response.
4. `routes/x.routes.ts` - wire paths/verbs/role guards to controller functions.
5. Mount it in `routes/index.ts`.
