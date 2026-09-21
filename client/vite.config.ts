import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

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
  const connectSrc = ["'self'", apiOrigin].filter(Boolean).join(" ");
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

  return {
    plugins: [react(), cspPlugin(apiOrigin)],
    server: {
      port: 5173,
      host: true,
      allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app'],
      proxy: { "/api": { target: "http://localhost:4000", changeOrigin: true } },
    },
  };
});
