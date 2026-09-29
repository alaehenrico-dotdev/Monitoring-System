import { defineConfig, loadEnv } from "vite";
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
function cspPlugin(apiOrigin) {
    // The realtime WebSocket connects to the same host as the API, just over
    // ws(s):// instead of http(s):// - explicit here rather than relying on
    // 'self' alone to also cover it.
    var wsOrigin = apiOrigin.replace(/^http/, "ws");
    var connectSrc = ["'self'", apiOrigin, wsOrigin].filter(Boolean).join(" ");
    var csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src ".concat(connectSrc),
        "object-src 'none'",
        "base-uri 'self'",
    ].join("; ");
    return {
        name: "inject-production-csp",
        apply: "build",
        transformIndexHtml: function (html) {
            return html.replace("<head>", "<head>\n    <meta http-equiv=\"Content-Security-Policy\" content=\"".concat(csp, "\" />"));
        },
    };
}
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), "VITE_");
    // VITE_API_URL is normally an absolute URL when the API is on its own
    // origin (see src/api/http.ts) - `connect-src` needs just the origin, not
    // the full path. A relative value (same-origin API) or an unset var needs
    // nothing extra, since `'self'` above already covers that case.
    var apiOrigin = "";
    try {
        if (env.VITE_API_URL)
            apiOrigin = new URL(env.VITE_API_URL).origin;
    }
    catch (_b) {
        // Relative VITE_API_URL (e.g. "/api") - same-origin, nothing to add.
    }
    return {
        plugins: [react(), cspPlugin(apiOrigin)],
        build: {
            rollupOptions: {
                output: {
                    // Vendor code changes far less often than app code, so it gets
                    // its own long-lived chunks: after a deploy the browser only has
                    // to re-download the (small) app chunk, not React/router/motion
                    // again. Nothing here changes what loads or when - these three
                    // groups were already all part of the one eager main chunk. The
                    // lazily-imported PDF libraries (jspdf, html2canvas, ...) are
                    // deliberately NOT listed, so they stay out of the initial load.
                    manualChunks: function (id) {
                        if (!id.includes("node_modules"))
                            return undefined;
                        if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id))
                            return "vendor-react";
                        if (/[\\/]node_modules[\\/](react-router|react-router-dom|@remix-run)[\\/]/.test(id))
                            return "vendor-router";
                        if (/[\\/]node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/.test(id))
                            return "vendor-motion";
                        return undefined;
                    },
                },
            },
        },
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
