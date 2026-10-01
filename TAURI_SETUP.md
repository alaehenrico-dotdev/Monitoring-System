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

## The server URL is baked in at build time

This was a deliberate tradeoff, not an oversight: **the installed app's
server URL is fixed at build time**, not a runtime setting. There is no
in-app "change server" screen.

- `client/.env.tauri` holds `VITE_API_URL` as an **absolute** URL (an office
  LAN IP like `http://192.168.1.50:4000/api`, or a stable ngrok domain) -
  unlike the web build, there's no dev-server proxy to ride through once the
  app is installed, so this has to be a real, reachable origin.
- `npm run build:tauri` (`vite build --mode tauri`) is what reads it; it's
  what `tauri build`'s `beforeBuildCommand` runs.
- **Implication:** if you need the installed app to point at a different
  server (e.g. you move from the office LAN to an ngrok tunnel, or the LAN IP
  changes), you must change `.env.tauri`, rebuild, and reinstall. There's no
  way to repoint an already-installed copy without doing that.
- `.env.tauri` is gitignored, same as `.env`/`.env.local` - copy
  `.env.tauri.example` and fill in the real value for a local build. The
  release workflow (below) writes it from a GitHub secret instead.

If this ever becomes a real pain point (e.g. the LAN IP changes often), the
fix is a small settings screen that persists a chosen server URL (via
`@tauri-apps/plugin-store` or similar) and has `http.ts` read it instead of
the baked-in `VITE_API_URL` - that's a deliberate follow-up, not something
this setup does today.

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

## npm scripts (added in `client/package.json`)

- `npm run tauri:dev` - run the desktop app in dev mode (start the server
  separately first).
- `npm run tauri:build` - build a signed-if-configured Windows installer.
- `npm run build:tauri` - just the frontend build step (`tsc -b && vite build
  --mode tauri`); this is what `tauri:build` calls internally via
  `beforeBuildCommand`, you don't normally run it directly.
