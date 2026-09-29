import { createServer } from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { attachRealtime, closeRealtime } from "./lib/realtime";

const app = createApp();
const server = createServer(app);
attachRealtime(server);

server.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Ala Eh Stocks Monitoring System API listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

// pm2 sends SIGTERM/SIGINT on restart/stop - without this the process (and
// any open WebSocket connections) would just be force-killed instead of
// letting connected clients close cleanly.
function shutdown() {
  closeRealtime();
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
