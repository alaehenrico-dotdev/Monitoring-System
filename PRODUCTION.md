# Running this in production (pm2 + ngrok)

This app's real deployment is still XAMPP's MySQL + an ngrok tunnel (see [`NGROK_SETUP.md`](NGROK_SETUP.md)
for the day-to-day "re-tunnel after an XAMPP reset" workflow) — this doc covers making that setup
production-grade instead of running dev-mode watchers under a plain terminal: process management
that survives a crash or a reboot, production builds instead of `tsx watch`/Vite's dev server, and
a tunnel URL that doesn't change every time it's restarted.

## 1. Build

From the repo root:

```bash
npm run build
```

This runs `prisma generate && tsc` for the server and `tsc -b && vite build` for the client
(unchanged, existing root script) — producing `server/dist` and `client/dist`.

## 2. Environment

Copy `server/.env.example` → `server/.env` on the production machine and fill in real values —
same requirements as dev (`DATABASE_URL`, `JWT_SECRET`, `DATA_RESET_PASSCODE`, no placeholder
values, see `server/src/config/env.ts`), plus:

- `NODE_ENV="production"`
- `CLIENT_ORIGIN` set to your reserved ngrok domain (step 4) instead of the `localhost:5173`
  default, so CORS is scoped to the real production URL.

`client/.env` should keep `VITE_API_URL=/api` (relative), same as the ngrok dev setup in
`NGROK_SETUP.md` — this is what lets the client, API, and realtime WebSocket all ride through one
tunnel origin.

## 3. Process management (pm2)

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
build — repeat step 1, then restart both apps).

## 4. Tunnel

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
