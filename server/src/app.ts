import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env";
import { TAURI_ORIGINS } from "./config/tauriOrigins";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { apiLimiter } from "./middleware/rateLimit";
import { requestLogger } from "./middleware/requestLogger";
import routes from "./routes";

export function createApp() {
  const app = express();

  // Trust exactly one reverse-proxy hop (ngrok, per PRODUCTION.md) so
  // `req.ip`/`X-Forwarded-For` resolve to the real client, not ngrok's own
  // local agent. Without this, Express's default (trust nothing) means
  // every request behind the tunnel looks like it came from the same
  // machine - the rate limiters below (keyed by IP) would then count every
  // real visitor's traffic as one shared bucket, and the login brute-force
  // guard (authLimiter) would do nothing for an attacker's real IP. `1`
  // (not `true`) deliberately trusts only the immediate hop - trusting the
  // whole chain would let a client forge its own `X-Forwarded-For` to fake
  // a different "IP" on every request and dodge the limiters entirely. No
  // proxy sits in front locally/in tests, so this is a no-op there (the
  // header is simply absent and `req.ip` falls back to the direct
  // connection, same as before).
  app.set("trust proxy", 1);

  // This server only ever returns JSON (see routes below) and never renders
  // HTML itself (the React client is a separate origin/deploy - see
  // client/vite.config.ts's own CSP for that) - `contentSecurityPolicy` is
  // disabled here since a CSP is meaningless for a document this server
  // never serves, but the rest of helmet's defaults (nosniff, no
  // `X-Powered-By`, HSTS, etc.) still harden every JSON response.
  app.use(helmet({ contentSecurityPolicy: false }));
  // The Tauri desktop client always reports one of TAURI_ORIGINS regardless
  // of which server it's pointed at, so they're allowed unconditionally
  // rather than needing their own env var. Every other origin still has to
  // match the single configured env.clientOrigin, same as before this
  // existed.
  const allowedOrigins = [env.clientOrigin, ...TAURI_ORIGINS];
  // `exposedHeaders` for Content-Disposition - without this, a cross-origin
  // fetch() (client and server are separate origins by default, see
  // env.clientOrigin) can read the response body but the Headers object
  // silently withholds Content-Disposition, which is how api/backup.ts
  // (and any other streamed-download endpoint) recovers the real filename.
  // Missing this doesn't break the download itself - only its filename,
  // which then silently falls back to a generic one.
  app.use(
    cors({
      // No Origin header at all (curl, server-to-server) has nothing for a
      // browser to enforce either way - only a browser-sent Origin that
      // isn't in the allowlist is actually rejected.
      origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
      credentials: true,
      exposedHeaders: ["Content-Disposition"],
    }),
  );
  app.use(express.json());
  app.use(requestLogger);

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api", apiLimiter, routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
