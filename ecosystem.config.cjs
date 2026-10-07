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
    },
  ],
};
