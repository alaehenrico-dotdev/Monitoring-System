import { invalidatePrefix } from "./cache";
import type { Server as HttpServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { verifyToken } from "../utils/jwt";

/**
 * Single shared realtime broadcast channel (same "one shared instance" shape
 * as lib/prisma.ts), so every write-service can tell every connected client
 * "something changed, go refetch" without owning any socket/connection logic
 * itself.
 *
 * The browser WebSocket API can't set an Authorization header, and this
 * codebase's only auth precedent is that header (middleware/auth.ts) - rather
 * than inventing a query-string token (which proxy logs and any
 * access log would then capture), a connection is accepted un-authenticated
 * and must send `{"type":"auth","token":"<jwt>"}` as its first message within
 * AUTH_TIMEOUT_MS or it's closed. Only authenticated sockets receive
 * broadcasts.
 */
const AUTH_TIMEOUT_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;

const authenticatedClients = new Set<WebSocket>();

export function attachRealtime(server: HttpServer): void {
  const wss = // maxPayload: the only thing a client ever sends is a tiny auth message,
  // so don't accept the 100 MiB ws default from an unauthenticated peer.
  new WebSocketServer({ noServer: true, maxPayload: 4096 });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/ws")) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    // Without an "error" listener, a malformed frame from any peer (even an
    // unauthenticated one) is an uncaught exception, which server.ts turns
    // into a full process shutdown.
    ws.on("error", () => ws.terminate());

    const authTimer = setTimeout(() => {
      ws.close(4001, "Auth timeout");
    }, AUTH_TIMEOUT_MS);

    ws.once("message", (raw) => {
      clearTimeout(authTimer);
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type !== "auth" || typeof msg.token !== "string") {
          throw new Error("Expected an auth message");
        }
        verifyToken(msg.token);
        authenticatedClients.add(ws);
      } catch {
        ws.close(4001, "Unauthorized");
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      authenticatedClients.delete(ws);
    });
  });

  // Standard ws dead-connection reaping (ping/pong) - Nginx and other
  // proxies in front of this server commonly drop idle connections without
  // ever sending a close frame, so a missed pong is the only signal.
  const heartbeat = setInterval(() => {
    for (const ws of authenticatedClients) {
      if ((ws as WebSocket & { isAlive?: boolean }).isAlive === false) {
        ws.terminate();
        continue;
      }
      (ws as WebSocket & { isAlive?: boolean }).isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  wss.on("connection", (ws: WebSocket) => {
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    ws.on("pong", () => {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    });
  });

  wss.on("close", () => clearInterval(heartbeat));
}

/// Called after every committed data change (saves, publish, reset, restore).
/// Also drops the dashboard's cached days-of-stock aggregate: it is a 60s
/// cache over the stock tables, so without this a reset (or any save) left it
/// showing the previous data for up to a minute while every other card was
/// already correct.
export function broadcastRealtimeEvent(): void {
  invalidatePrefix("days-of-stock:");
  const message = JSON.stringify({ type: "data-changed", at: new Date().toISOString() });
  for (const ws of authenticatedClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
  }
}

export function closeRealtime(): void {
  for (const ws of authenticatedClients) ws.close(1001, "Server shutting down");
  authenticatedClients.clear();
}
