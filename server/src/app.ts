import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { apiLimiter } from "./middleware/rateLimit";
import { requestLogger } from "./middleware/requestLogger";
import routes from "./routes";
import { prisma } from "./lib/prisma";
import { asyncHandler } from "./utils/asyncHandler";

export function createApp() {
  const app = express();

  // Which peers may set `X-Forwarded-For`, as an address allowlist (default
  // loopback for the local Nginx reverse proxy in PRODUCTION.md).
  // Behind that proxy `req.ip` is the real client, so the IP-keyed limiters
  // below bucket per visitor instead of lumping the whole tunnel together.
  //
  // This used to be a hop count of `1`, which trusts whoever the nearest
  // sender happens to be. server.ts also accepts direct connections, so a
  // client reaching the port straight could forge `X-Forwarded-For`, pick a
  // new `req.ip` per request and walk around every limiter in
  // middleware/rateLimit.ts - the login and passcode brute-force guards
  // included. Keyed by address instead, a forged header from an untrusted
  // peer is ignored and `req.ip` stays the real socket address.
  //
  // See config/env.ts's trustProxySetting() for the accepted values.
  app.set("trust proxy", env.trustProxy);

  // This server only ever returns JSON (see routes below) and never renders
  // HTML itself (the React client is a separate origin/deploy - see
  // client/vite.config.ts's own CSP for that) - `contentSecurityPolicy` is
  // disabled here since a CSP is meaningless for a document this server
  // never serves, but the rest of helmet's defaults (nosniff, no
  // `X-Powered-By`, HSTS, etc.) still harden every JSON response.
  app.use(helmet({ contentSecurityPolicy: false }));
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
      origin: (origin, callback) =>
        callback(null, !origin || origin === env.clientOrigin),
      credentials: true,
      exposedHeaders: ["Content-Disposition"],
    }),
  );
  // Mounted before express.json() below: a client over its limit is turned
  // away before the server spends anything reading and parsing up to 1 MB of
  // body per request, which is the cheap part of the flood to skip.
  app.use("/api", apiLimiter);
  // API JSON payloads are small; keep an explicit cap so an accidental or
  // hostile oversized body cannot consume unbounded memory. Restore uploads
  // use their own streaming limit in backup.service.ts.
  app.use(express.json({ limit: "1mb" }));
  app.use(requestLogger);

  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  // Used by external uptime monitoring and client connectivity checks. A
  // running API with an unreachable database is not ready to serve the app,
  // so include a lightweight DB round-trip in this check.
  app.get("/health", asyncHandler(async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", database: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable", database: "unreachable" });
    }
  }));

  app.use("/api", routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
