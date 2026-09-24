# JWT storage: localStorage vs. an httpOnly cookie

This is an evaluation, not a plan to implement. Nothing here should be built
without an explicit go-ahead - see the "Migration plan" section for what
that would actually involve if we do.

## Current state

- The client stores the JWT in `localStorage` under the key `"ala-eh-token"`
  (`client/src/api/http.ts`), reads it back on every request to set
  `Authorization: Bearer <token>`, and clears it on logout or a 401 (see the
  global 401 handler added alongside this document).
- The server issues the token at login (`server/src/services/auth.service.ts`)
  and verifies it per-request in `server/src/middleware/auth.ts`, which now
  also re-checks `isActive`/role against the DB on a short TTL (see that
  middleware's own comment) - so a revoked session already can't outlive its
  token by much, independent of where the token itself lives.
- CORS is already configured with `credentials: true`
  (`server/src/app.ts`: `cors({ origin: env.clientOrigin, credentials: true })`),
  which is required for cookie-based auth to work cross-origin (client on
  `:5173`, API on `:4000` in dev) but currently unused for anything, since
  no cookie is set.

## The risk `localStorage` carries

Any JavaScript that runs on the page - including a successful XSS
injection anywhere in the client bundle or its dependencies - can read
`localStorage` and exfiltrate the token directly. An httpOnly cookie is
invisible to JavaScript entirely; an XSS bug would still let an attacker
*make requests as the logged-in user* (since the browser attaches the
cookie automatically), but couldn't steal the token itself to replay
later from outside the browser. This app doesn't render arbitrary
user-supplied HTML/markdown anywhere obvious today, which narrows the
realistic XSS surface, but a stored token is a bigger prize than most if
that surface is ever found (session for as long as `JWT_EXPIRES_IN`, no
device binding).

The tradeoff isn't free, though: moving to a cookie trades one class of
attack (token theft via XSS) for needing to actively defend against a
different one (CSRF), since the browser now sends the cookie automatically
on every request to the API's origin, including ones a malicious page
elsewhere could trigger.

## What an httpOnly cookie migration requires

1. **Server: `Set-Cookie` on login.** `auth.service.ts`'s `login()` returns
   `{ token, user }` today - `auth.controller.ts` would instead set the
   cookie directly on the response (`res.cookie("ala-eh-token", token, {
   httpOnly: true, secure: <prod>, sameSite: "lax", maxAge: ... })`) and stop
   returning the raw token in the JSON body.
2. **Server: read the cookie instead of the `Authorization` header.**
   `middleware/auth.ts`'s `authenticateHandler` reads
   `req.headers.authorization` today; it would need to read `req.cookies`
   instead (via `cookie-parser`, not currently a dependency), and logout
   would clear the cookie (`res.clearCookie(...)`) rather than the client
   just discarding a token it held.
3. **CSRF protection.** Since the browser now attaches the cookie
   automatically, any other origin can trigger a state-changing request
   (create/edit/delete) that rides the user's session unless something
   proves the request actually came from this app's own frontend. The
   standard fix is a double-submit token: the server also sets a second,
   *non*-httpOnly cookie (e.g. `csrf-token`) the client can read and echo
   back as a custom header (e.g. `X-CSRF-Token`) on every mutating request;
   the server rejects the request if the header doesn't match the cookie.
   `http.ts`'s `request()` would need to attach that header, and a new
   middleware would need to verify it (only on non-GET requests - reads
   don't need it).
4. **Client: stop managing the token entirely.** `getToken`/`setToken` and
   the `Authorization` header logic in `http.ts` go away; `fetch` calls need
   `credentials: "include"` so the cookie is actually sent cross-origin in
   dev (client `:5173` -> API `:4000`). `AuthContext`'s bootstrap check
   (`getMe()`) becomes the *only* way the client learns whether it's logged
   in - there's no local token to inspect anymore, which also means the
   existing `sessionError` "no session vs. server unreachable" distinction
   becomes even more load-bearing than it already is.
5. **Login page / dev environment specifics.** `secure: true` on the cookie
   would block it over plain `http://localhost` unless dev explicitly opts
   out for local testing (common pattern: `secure: env.isProduction`).
   `sameSite: "lax"` is the right default for a same-site-ish app like this
   (client and API are different ports but the same logical deployment);
   `"strict"` would likely break the Vite dev proxy setup in some flows and
   isn't needed here since there's no legitimate top-level cross-site
   navigation into this app that needs the cookie.
6. **The 401 handler and revocation check added in this same pass keep
   working unchanged** either way - both operate on "the request failed
   with 401", which is identical whether the credential that failed was a
   header or a cookie.

## Recommendation

Worth doing eventually, not urgent given the revocation check already
landed (item 1) meaningfully shrinks the blast radius of a stolen token
regardless of where it's stored - a stolen token now stops working within
`USER_STATUS_TTL_MS` of being deactivated, same as a stolen cookie would.
The main remaining argument for cookies is defense-in-depth against XSS
specifically; if/when we do it, budget for the CSRF middleware and the
`cookie-parser` dependency as real scope, not an afterthought - a cookie
migration that forgets CSRF protection is a regression, not a hardening.

## Migration plan (if/when approved)

1. Add `cookie-parser` to `server/package.json`; wire it in `app.ts`.
2. Add the CSRF double-submit middleware (new file,
   e.g. `server/src/middleware/csrf.ts`) and apply it to all non-GET
   `/api` routes.
3. Change `auth.controller.ts`'s login/logout handlers to set/clear the
   `ala-eh-token` cookie (httpOnly) and a paired `csrf-token` cookie
   (readable).
4. Change `middleware/auth.ts` to read the cookie instead of the
   `Authorization` header.
5. Update `client/src/api/http.ts`: drop `getToken`/`setToken`, add
   `credentials: "include"` to every request, attach `X-CSRF-Token` read
   from the `csrf-token` cookie on mutating requests.
6. Update `AuthContext.tsx`: nothing structural changes (it already treats
   `getMe()` as the source of truth), but double-check the "had a token"
   heuristic (`getToken() !== null`) that currently distinguishes "never
   logged in" from "token expired" - that signal goes away, so that
   distinction would need a different source (e.g. always treat a 401 on
   bootstrap as ordinary, since there's no longer a cheap local check).
7. Update or delete any test relying on `getToken`/`setToken` from
   `api/http.ts`.
8. Manually verify: login sets both cookies; a request without the CSRF
   header is rejected; logout clears both cookies; the Vite dev proxy still
   forwards cookies correctly cross-port in dev.
