# ngrok setup (re-tunneling after an XAMPP reset)

Resetting XAMPP only affects MySQL/Apache — ngrok itself is a separate tool, but a full reset
often wipes its saved authtoken too, so you're usually starting from a blank ngrok config as well.
This walks through getting a shareable tunnel back up for this project.

## 1. Confirm XAMPP + the database are back up first

ngrok just exposes what's already running locally, so get the app itself working again before
tunneling it:

```bash
# Start MySQL in the XAMPP control panel, then confirm the DB exists again
# (re-import server/prisma/full_schema.sql via phpMyAdmin if it's a fresh database)

cd server
# .env should still have DATABASE_URL pointing at XAMPP's MySQL, e.g.:
# mysql://root:@localhost:3306/ala_eh_stocks
npm run seed          # only if the users/products tables are empty
npm run dev           # or `npm run dev` from the repo root to start API + client together
```

Confirm `http://localhost:5173` (client) and `http://localhost:4000` (API) both work locally
before moving on — a tunnel just forwards whatever's already broken.

## 2. Re-authenticate ngrok

If ngrok was reinstalled or its config directory got wiped by the reset, it forgets your
authtoken and refuses to start a tunnel until you add it back:

```bash
ngrok config add-authtoken <your-authtoken>
```

Get `<your-authtoken>` from the [ngrok dashboard](https://dashboard.ngrok.com/get-started/your-authtoken)
(log in with your existing account — no need to re-signup).

## 3. Point the client at the API through the same origin

This project's Vite dev server already proxies `/api/*` to `http://localhost:4000`
(`client/vite.config.ts`, `server.proxy`). Using that proxy — instead of the client calling
`http://localhost:4000` directly — means the browser only ever talks to the one ngrok origin, so
you don't need to touch the server's `CLIENT_ORIGIN` CORS setting or fight cross-origin issues:

```bash
cd client
# in client/.env:
VITE_API_URL=/api
```

Restart `npm run dev` after changing this so Vite picks it up.

## 4. Start the tunnel

```bash
ngrok http 5173
```

`client/vite.config.ts` already whitelists ngrok's free-tier hostnames
(`allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app']`), so Vite won't reject the request when it
arrives through the tunnel — no config change needed there.

ngrok prints a forwarding URL, e.g.:

```
Forwarding   https://abcd1234.ngrok-free.app -> http://localhost:5173
```

Share that `https://...ngrok-free.app` URL — that's the whole app (client + proxied API) from one
link.

## Notes / troubleshooting

- **Free ngrok URLs are random each run** — restarting `ngrok http 5173` gives you a new URL every
  time. Re-share it whenever you restart the tunnel. (A paid ngrok plan can reserve a static
  domain — pass it with `ngrok http --url=<your-reserved-domain> 5173` instead.)
- **"Blocked request" / host not allowed error from Vite** — only happens if ngrok gives you a
  domain suffix other than `.ngrok-free.dev` / `.ngrok-free.app` (e.g. a reserved custom domain on
  a paid plan). Add that exact host to `allowedHosts` in `client/vite.config.ts`.
- **CORS errors in the browser console** — means `VITE_API_URL` isn't set to the relative `/api`
  from step 3, so the client is calling `localhost:4000` directly instead of going through the
  proxy, which the ngrok visitor's browser can't reach.
- **Login/API calls fail with a DB error** — XAMPP's MySQL isn't running, or `server/.env`'s
  `DATABASE_URL` doesn't match the database you just recreated. Check the XAMPP control panel and
  `.env` before re-checking ngrok.
