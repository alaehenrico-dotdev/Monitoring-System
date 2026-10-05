# Desktop app (Tauri)

The React client can be packaged as a Windows desktop app with
[Tauri](https://v2.tauri.app/). It's a **thin client**: the installer only
contains the frontend. It still talks to the same Express API over HTTP and
the same realtime endpoint over WebSocket - nothing server-side is bundled or
changes.

All Tauri-specific files live under `client/src-tauri/`.

## One-time local setup

`tauri dev` / `tauri build` compile a small Rust shell around the webview, so
unlike the rest of this repo, you need the Rust toolchain installed once per
machine:

1. Install Rust via [rustup.rs](https://rustup.rs/).
2. Install the **Visual Studio Build Tools** (MSVC + Windows SDK) - the
   Tauri docs' [Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows)
   page links the exact installer. WebView2 itself is already present on
   current Windows 10/11.
3. Run `tauri info` from `client/` (`npx tauri info`) to confirm everything
   above shows a checkmark before continuing.

This is only needed on machines that will *build* the app. Nothing about
running the installed app on an end user's machine requires any of this.

## Running it in dev

The Express server is **not** started automatically - start it the normal
way first (`npm run dev:server` from the repo root, or `npm run dev` for
both), then from `client/`:

```bash
npm run tauri:dev
```

This boots the regular Vite dev server (port 5173) and points a Tauri window
at it - same dev proxy, same `.env`/`.env.local`, same HMR as developing in a
browser. `.env.tauri` (below) isn't involved in dev; it only matters for
`tauri:build`.

## Server address and using the app on different networks

The installer includes a default server URL, and the installed app also has
a **“Can't connect? Change server address”** option on its login screen. It
checks the new address before switching and stores it on that device, so
changing the server URL does not require rebuilding or reinstalling.

For use across different routers, configure a stable **HTTPS** address for
the server, such as a reserved tunnel domain, and enter it once in that
screen. The app's API, health checks, and realtime connection then use that
same address wherever the device has internet access. A private LAN address
only works while the device can route to that LAN; the app cannot discover a
server hidden behind another router or make a private server reachable by
itself. The server still needs to be running and exposed through the tunnel.

- `client/.env.tauri` holds `VITE_API_URL` as an **absolute** URL (an office
  LAN IP like `http://192.168.1.50:4000/api`, or a stable ngrok domain) -
  unlike the web build, there's no dev-server proxy to ride through once the
  app is installed, so this has to be a real, reachable origin.
- `npm run build:tauri` (`vite build --mode tauri`) is what reads it; it's
  what `tauri build`'s `beforeBuildCommand` runs.
- `.env.tauri` supplies only the initial/default address. You can change the
  address later from the login screen without rebuilding.
- `.env.tauri` is gitignored, same as `.env`/`.env.local` - copy
  `.env.tauri.example` and fill in the real value for a local build. The
  release workflow (below) writes it from a GitHub secret instead.
- **Two server-side/browser settings affect whether the connection works:**
  - `server/src/app.ts`'s CORS allowlist needs `CLIENT_ORIGIN` (or the
    always-allowed Tauri origins) to match where requests are actually coming
    from - a mismatch here fails silently as a generic "Login failed", not a
    CORS error you'd notice without DevTools open. The Tauri app's real
    origin on Windows WebView2 is **`http://tauri.localhost`** - confirmed
    from an actual DevTools CORS error, not from Tauri's own docs, which
    suggest `https://tauri.localhost` instead (wrong, at least for the
    WebView2 version this was tested against). All three variants
    (`tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost`)
    are allowlisted defensively in case this differs by platform or WebView2
    version.
  - `client/src-tauri/tauri.conf.json`'s `app.windows[].additionalBrowserArgs`
    hardcodes `--unsafely-treat-insecure-origin-as-secure=<origin>` for the
    plain-http LAN origin, since WebView2 treats the app's own page as a
    secure context and otherwise blocks "mixed content" requests to a
    non-https API. **This origin is a literal string, not derived from
    `.env.tauri`** - if you ever change the server's address, update this
    value too, or the desktop build will go back to silently failing to log
    in exactly like this.
  - `client/vite.config.ts`'s CSP (`extraConnectSrc` in `cspPlugin`) allows
    HTTPS API origins and secure WebSockets for runtime server changes, plus
    `http://ipc.localhost` - Tauri's internal IPC bridge for plugin calls
    (e.g. the updater's `check()`) uses that as a separate origin from the
    page's own, and without it in `connect-src`, those calls get silently
    downgraded to a slower fallback transport instead of erroring.

The desktop build's CSP permits HTTPS API and secure WebSocket origins so a
different stable HTTPS hostname can be selected at runtime. Plain HTTP LAN
addresses remain tied to the build-time WebView2 insecure-origin exception;
prefer HTTPS for a server that users reach from multiple networks.

## Building a signed installer locally

```bash
cd client
npm run tauri:build
```

Installers land in `client/src-tauri/target/release/bundle/` (`nsis/` and
`msi/`). This only produces a *signed update artifact* (the `.sig` files the
updater needs) if `TAURI_SIGNING_PRIVATE_KEY` is set in your environment -
see below. Without it, `tauri build` still produces working installers, just
ones the auto-updater can't verify.

## The updater and its signing key

The app checks GitHub Releases for updates on startup
(`client/src/tauri/updater.ts`), using the `@tauri-apps/plugin-updater`
plugin configured in `client/src-tauri/tauri.conf.json`
(`plugins.updater.endpoints`), pointed at
`https://github.com/alaehenrico-dotdev/Monitoring-System/releases/latest/download/latest.json`.
Every release must publish a `latest.json` (produced automatically by the CI
workflow below) alongside the installer.

A signing keypair was generated for this (minisign-based, via
`tauri signer generate`). **The public key is already committed** in
`tauri.conf.json` (`plugins.updater.pubkey`) - that's expected, it's how the
app verifies an update actually came from you.

**The private key is not committed anywhere.** It was generated once during
setup, shown so it could be copied out, and the temporary copy has since been
deleted - it does not exist on disk anywhere in this repo or project
directory. If you haven't already, store the copy you saved somewhere durable
and secret - e.g. a password manager, or an encrypted drive - and add its
contents as a GitHub Actions secret (Settings → Secrets and variables →
Actions → "New repository secret"):

| Secret name | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the full contents of the `.key` file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | leave unset - the key was generated without a password. Set this only if you later regenerate the key *with* a password. |
| `TAURI_API_URL` | the real server URL to bake into release builds, e.g. `https://your-tunnel.ngrok-free.app/api` or a static office LAN IP |

If this key is ever lost, generate a new one (`npx tauri signer generate`),
replace `pubkey` in `tauri.conf.json`, and update the GitHub secret -
installed apps signed with the old key simply won't be able to verify
updates signed with the new one, so this effectively resets the trust chain
(existing installs would need a manual reinstall once, since they can't
verify-then-trust a differently-signed update).

## Cutting a signed release

1. Bump the version in **both**:
   - `client/package.json` (`version`)
   - `client/src-tauri/tauri.conf.json` (`version`) - this is the one the
     updater actually compares against, so don't skip it.
2. Commit, then tag and push:
   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```
3. `.github/workflows/release.yml` picks up the `v*` tag, builds on
   `windows-latest`, signs the installer using the `TAURI_SIGNING_PRIVATE_KEY`
   secret, and creates a **draft** GitHub Release with the installer(s) and
   `latest.json` attached.
4. Go to the repo's Releases page, review the draft, and click
   **Publish release**. The release is deliberately left as a draft -
   nothing (no existing install's update check, no new download link) sees a
   release until you publish it. This is your chance to catch a bad build
   before every installed copy of the app offers it as an update.

## Offline support

The desktop app tolerates the server/network dropping - it does NOT work as
a fully standalone app with its own independent data (the central MySQL
database is still the single source of truth; see `server/`).

- **While offline:** grids/reports already opened before the drop stay
  viewable (served from a local cache instead of going blank), and Save
  still works - failed writes are queued locally instead of erroring.
- **On reconnect:** queued writes replay automatically, in the order they
  were made. A small badge in the bottom corner shows how many are still
  waiting.

How it's built (`client/src/api/http.ts`, `client/src/tauri/offlineStore.ts`,
`client/src/tauri/OfflineSyncBadge.tsx`, `client/src-tauri/src/dpapi.rs`):

- A local SQLite database (`@tauri-apps/plugin-sql`) holds two tables: a
  read cache (last-known response per GET path) and a write outbox (queued
  POST/PUT/PATCH/DELETE bodies, replayed in order).
- Every value stored in either table is encrypted first via Windows DPAPI
  (`CryptProtectData`/`CryptUnprotectData`, `Scope::User`) - tied to the
  current Windows user account, no password to set or lose. This protects
  the database file's contents if it's copied off the machine or opened
  under a different Windows account; it does **not** protect against
  someone already logged into the same Windows account this app runs under
  - same trust boundary the rest of that Windows login already has.
- `http.ts`'s `request()` only triggers this for an actual connectivity
  failure (`fetch()` throwing before any response, e.g. DNS/connection
  refused/timeout) - a real 4xx/5xx from a reachable server is never cached
  or queued, since retrying it wouldn't help.
- A queued write the server later actively rejects (not a connectivity
  failure - the server was reachable and said no, most likely because
  whatever it was staged against has since changed) is dropped from the
  queue rather than retried forever, and logged to the console. There's no
  conflict-resolution UI for this yet - the original typed value is still
  wherever the user entered it (`usePendingEntryChanges` keeps staged edits
  in `sessionStorage` until a save actually succeeds), so nothing is
  silently lost, but it does need a human to notice and redo it. A real
  conflict UI (reusing `detectConflicts`/`PendingConflict`, already built
  for the web app's offline-ish staging) is the natural next step if this
  turns out to happen often.
- None of this touches the plain web build - `offlineStore.ts` and
  `OfflineSyncBadge.tsx` are only ever reached through a dynamic `import()`
  gated on `import.meta.env.MODE === "tauri"`, so their SQLite/DPAPI
  dependency never ends up in that bundle.

## npm scripts (added in `client/package.json`)

- `npm run tauri:dev` - run the desktop app in dev mode (start the server
  separately first).
- `npm run tauri:build` - build a signed-if-configured Windows installer.
- `npm run build:tauri` - just the frontend build step (`tsc -b && vite build
  --mode tauri`); this is what `tauri:build` calls internally via
  `beforeBuildCommand`, you don't normally run it directly.
