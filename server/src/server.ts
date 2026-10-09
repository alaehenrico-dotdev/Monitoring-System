import { createServer } from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { attachRealtime, closeRealtime } from "./lib/realtime";

const app = createApp();
const server = createServer(app);
attachRealtime(server);

server.listen(env.port, env.host, () => {
  // eslint-disable-next-line no-console
  console.log(`Ala Eh Stocks Monitoring System API listening on http://${env.host}:${env.port} (${env.nodeEnv})`);
});

/**
 * How long to let in-flight requests finish before exiting anyway.
 *
 * pm2 sends SIGTERM and then SIGKILLs after its own `kill_timeout` (1.6s by
 * default, raised to 10s in ecosystem.config.cjs). Staying comfortably under
 * that means this process chooses its own exit - flushing logs and closing
 * the database pool - instead of being shot while a stock write is
 * mid-transaction.
 */
const SHUTDOWN_GRACE_MS = 8000;

let shuttingDown = false;

async function shutdown(signal: string) {
  // pm2 restarts can deliver a second signal while the first is still
  // draining; without this guard that would start a second teardown and
  // double-close the server.
  if (shuttingDown) return;
  shuttingDown = true;
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));

  // Force-exit timer first, so a connection that never drains can't keep the
  // process alive past the deadline. `unref` so it isn't itself a reason to
  // stay up if everything closes cleanly well before then.
  const forceExit = setTimeout(() => {
    console.error(JSON.stringify({ level: "error", event: "shutdown-timeout", signal }));
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  forceExit.unref();

  closeRealtime();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // Closed after the HTTP server, not before: a request still being served
  // needs its database connection until it has finished responding.
  await prisma.$disconnect().catch(() => {
    // Already gone, or never connected. Nothing useful left to do at exit.
  });
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// A promise rejection nobody handled leaves the process in an unknown state
// - Node's default is to warn and carry on, which is how a half-failed
// request pipeline keeps serving traffic. Log it with the same structure as
// everything else and let pm2 restart into a known-good state.
process.on("unhandledRejection", (reason) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "unhandledRejection",
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : null,
    }),
  );
  void shutdown("unhandledRejection");
});

process.on("uncaughtException", (err) => {
  console.error(
    JSON.stringify({ level: "error", event: "uncaughtException", message: err.message, stack: err.stack }),
  );
  void shutdown("uncaughtException");
});
