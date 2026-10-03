// pm2 process definitions for production (see PRODUCTION.md). Two apps,
// matching the same two-origin shape `npm run dev` already uses - just
// running production builds instead of dev-mode watchers.
module.exports = {
  apps: [
    {
      name: "ala-eh-api",
      cwd: "./server",
      script: "dist/server.js",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
    },
    {
      name: "ala-eh-client",
      cwd: "./client",
      // `vite preview` serves the production build and still proxies
      // /api + /ws to the API (see vite.config.ts's `preview` block) - the
      // one origin ngrok tunnels (see PRODUCTION.md).
      //
      // Points at vite's actual JS entry, not the node_modules/.bin/vite
      // shim - that shim is a POSIX shell script with a Node shebang trick
      // (`#!/usr/bin/env node` + a sh re-exec), which only works when
      // something execs it directly as a shebang script. PM2 on Windows
      // instead runs it as `node <script>`, so node tries to parse the
      // whole shell script as JavaScript and fails immediately
      // ("SyntaxError: missing ) after argument list") - ala-eh-client
      // crash-loops on every single start. vite/bin/vite.js is the real
      // entry point (also shebang-prefixed, but otherwise plain JS, so
      // `node vite.js` runs it fine on every platform). It's hoisted to the
      // repo root's node_modules (npm workspaces), one level up from this
      // app's own `cwd`.
      script: "../node_modules/vite/bin/vite.js",
      args: "preview --port 5173",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
    },
  ],
};
