import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { apiLimiter } from "./middleware/rateLimit";
import routes from "./routes";

export function createApp() {
  const app = express();

  // This server only ever returns JSON (see routes below) and never renders
  // HTML itself (the React client is a separate origin/deploy - see
  // client/vite.config.ts's own CSP for that) - `contentSecurityPolicy` is
  // disabled here since a CSP is meaningless for a document this server
  // never serves, but the rest of helmet's defaults (nosniff, no
  // `X-Powered-By`, HSTS, etc.) still harden every JSON response.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api", apiLimiter, routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
