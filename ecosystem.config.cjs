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
      script: "node_modules/.bin/vite",
      args: "preview --port 5173",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
    },
  ],
};
