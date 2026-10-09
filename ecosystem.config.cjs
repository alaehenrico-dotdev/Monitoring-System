// PM2 runs the API; Nginx serves the built client and proxies API/WebSocket
// traffic (see PRODUCTION.md).
module.exports = {
  apps: [
    {
      name: "ala-eh-api",
      cwd: "./server",
      script: "dist/server.js",
      env: { NODE_ENV: "production", HOST: "127.0.0.1" },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      // Longer than server.ts's own SHUTDOWN_GRACE_MS (8s), so the process
      // always gets to finish draining and close the database pool itself
      // rather than being SIGKILLed mid-transaction at pm2's 1.6s default.
      kill_timeout: 10000,
      // pm2 waits for process.send("ready") before considering a restart
      // successful; this app doesn't signal readiness, so listen for the
      // plain start instead and don't hold reloads open waiting.
      wait_ready: false,
    },
  ],
};
