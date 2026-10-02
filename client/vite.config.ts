import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// This file runs as ESM (client/package.json's "type": "module"), so there's
// no __dirname - derived the same way Node's own docs recommend.
const rootDir = fileURLToPath(new URL(".", import.meta.url));

// Single source of truth for every "what version is this" display in the app
// (Sidebar account popover, Tauri window title) - read once at build time
// rather than bundling package.json itself or hand-duplicating the number.
const appVersion = (JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as { version: string }).version;

/**
 * Injects a Content-Security-Policy `<meta>` tag into the built index.html -
 * production only (`apply: "build"`), never the dev server. Vite's dev
 * client (HMR websocket, React Fast Refresh) relies on patterns a strict CSP
 * would otherwise have to special-case, so this only ever ships in what
 * actually gets deployed, and local `npm run dev` is completely unaffected.
 *
 * `style-src` allows `'unsafe-inline'`: every component in this app styles
 * itself via a React `style={{...}}` prop (there's no CSS-modules/nonce
 * plumbing anywhere), which renders as literal inline `style="..."`
 * attributes - `style-src` can't be locked down to hashes/nonces without
 * first moving the whole app off that pattern, which is a separate, much
 * larger rewrite. `script-src` has no such exception: nothing in this app
 * injects `<script>` tags or uses `eval`/`dangerouslySetInnerHTML`, so it
 * stays as strict as the directive allows.
 */
function cspPlugin(apiOrigin: string, extraConnectSrc: string[] = []): Plugin {
  // The realtime WebSocket connects to the same host as the API, just over
  // ws(s):// instead of http(s):// - explicit here rather than relying on
  // 'self' alone to also cover it.
  const wsOrigin = apiOrigin.replace(/^http/, "ws");
  const connectSrc = ["'self'", apiOrigin, wsOrigin, ...extraConnectSrc].filter(Boolean).join(" ");
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");

  return {
    name: "inject-production-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
  };
}

/**
 * Fills the service worker's precache list (public/sw.js is copied to dist
 * as-is) with every file the build actually emitted, so the whole app - lazy
 * page chunks included - is available offline after the first load. The
 * cache version is a hash of that file list, so a new deploy (new hashed
 * asset names) replaces the old cache instead of serving stale code.
 */
function pwaPrecachePlugin(): Plugin {
  let outDir = "dist";
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const full = join(dir, f);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  return {
    name: "pwa-precache",
    apply: "build",
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = walk(outDir)
        .map((f) => "/" + relative(outDir, f).split("\\").join("/"))
        .filter((f) => f !== "/sw.js" && !f.endsWith(".map") && !/\.(webm|mp4)$/.test(f))
        .sort();
      const version = createHash("sha1").update(files.join(",")).digest("hex").slice(0, 10);
      const swPath = join(outDir, "sw.js");
      const sw = readFileSync(swPath, "utf8")
        .replace("__SW_VERSION__", version)
        .replace("self.__PRECACHE__ || []", JSON.stringify(files));
      writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  // VITE_API_URL is normally an absolute URL when the API is on its own
  // origin (see src/api/http.ts) - `connect-src` needs just the origin, not
  // the full path. A relative value (same-origin API) or an unset var needs
  // nothing extra, since `'self'` above already covers that case.
  let apiOrigin = "";
  try {
    if (env.VITE_API_URL) apiOrigin = new URL(env.VITE_API_URL).origin;
  } catch {
    // Relative VITE_API_URL (e.g. "/api") - same-origin, nothing to add.
  }

  // The Tauri build serves the app from a custom-scheme origin rather than
  // http(s) - confirmed from an actual DevTools CSP violation to be
  // http://tauri.localhost on Windows WebView2, not https:// as Tauri's own
  // docs suggest - tauri://localhost covers other platforms. 'self' already
  // covers same-origin fetches to whichever of these is the page's own
  // origin, but Tauri's internal IPC bridge calls a DIFFERENT origin
  // (http://ipc.localhost) for plugin invokes (e.g. the updater's check()),
  // which needs its own entry or Tauri silently falls back to a slower
  // postMessage transport instead of erroring outright.
  const isTauri = mode === "tauri";
  const extraConnectSrc = isTauri
    ? ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://ipc.localhost"]
    : [];

  return {
    base: "./",
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
    plugins: [react(), cspPlugin(apiOrigin, extraConnectSrc), pwaPrecachePlugin()],
    server: {
      port: 5173,
      host: true,
      allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app'],
      proxy: {
        "/api": { target: "http://localhost:4000", changeOrigin: true },
        "/ws": { target: "http://localhost:4000", ws: true },
      },
    },
    // `vite preview` serves the production build (see PRODUCTION.md) - same
    // proxy shape as dev so it still fronts the API/realtime through one
    // origin for the ngrok tunnel, just pointed at built assets instead of
    // Vite's dev transform.
    preview: {
      port: 5173,
      host: true,
      allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app'],
      proxy: {
        "/api": { target: "http://localhost:4000", changeOrigin: true },
        "/ws": { target: "http://localhost:4000", ws: true },
      },
    },
  };
});
