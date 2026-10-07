import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// This file runs as ESM (client/package.json's "type": "module"), so there's
// no __dirname - derived the same way Node's own docs recommend.
const rootDir = fileURLToPath(new URL(".", import.meta.url));

// Single source for the version display in the app (Sidebar account popover).
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
function cspPlugin(apiOrigin: string): Plugin {
  // The realtime WebSocket connects to the same host as the API, just over
  // ws(s):// instead of http(s):// - explicit here rather than relying on
  // 'self' alone to also cover it.
  const wsOrigin = apiOrigin.replace(/^http/, "ws");
  const connectSrc = ["'self'", "wss:", apiOrigin, wsOrigin].filter(Boolean).join(" ");
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
  // For an absolute API URL, CSP needs its origin rather than the full path.
  // Same-origin deployments use the page origin and secure WebSocket scheme.
  let apiOrigin = "";
  try {
    if (env.VITE_API_URL) apiOrigin = new URL(env.VITE_API_URL).origin;
  } catch {
    // Relative VITE_API_URL (e.g. "/api") - same-origin, nothing to add.
  }

  return {
    base: "/",
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
    plugins: [react(), cspPlugin(apiOrigin), pwaPrecachePlugin()],
    build: {
      rollupOptions: {
        output: {
          // React/router/motion change only when a dependency is upgraded,
          // while app code changes every deploy. Bundled together they share
          // one hashed filename, so editing a page invalidates the framework
          // too and returning users re-download all of it. Split out, a
          // normal deploy only busts the (much smaller) app chunk.
          //
          // The lazily-imported PDF libraries (jspdf, html2canvas) are
          // deliberately absent: they already get their own chunks via the
          // dynamic import in utils/tablePdf.ts, and naming them here would
          // pull them into the initial load.
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "vendor-react";
            if (/\/node_modules\/(react-router|react-router-dom|@remix-run)\//.test(id)) return "vendor-router";
            if (/\/node_modules\/(motion|motion-dom|motion-utils|framer-motion)\//.test(id)) return "vendor-motion";
            return undefined;
          },
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      host: true,
      proxy: {
        "/health": { target: "http://127.0.0.1:4000", changeOrigin: true },
        "/api": { target: "http://127.0.0.1:4000", changeOrigin: true },
        "/ws": { target: "http://127.0.0.1:4000", ws: true },
      },
    },
    // Local production-build preview. Production deploys serve dist/ through
    // Nginx and proxy these same API, health, and WebSocket paths.
    preview: {
      port: 5173,
      strictPort: true,
      host: true,
      proxy: {
        "/health": { target: "http://127.0.0.1:4000", changeOrigin: true },
        "/api": { target: "http://127.0.0.1:4000", changeOrigin: true },
        "/ws": { target: "http://127.0.0.1:4000", ws: true },
      },
    },
  };
});
