import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

/// Logs one structured JSON line per request (method, path, status,
/// duration, and the authenticated user id if any) so a request can be
/// traced end to end in production. Listens on "finish" rather than logging
/// up front, so it fires after the whole pipeline - by then req.user is
/// populated if authenticate ran for this route. Purely additive: doesn't
/// touch HttpError/errorHandler.ts at all.
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  // Generated here rather than trusted from an inbound header: a client-
  // supplied id could be repeated or forged to poison the logs. Echoed on
  // the response so a user can quote it when reporting a failure.
  req.id = randomUUID();
  res.setHeader("X-Request-Id", req.id);

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    // eslint-disable-next-line no-console -- structured access log, not a stray debug statement
    console.log(
      JSON.stringify({
        requestId: req.id,
        method: req.method,
        // Query strings can contain user supplied filters or future secrets.
        // Log only the route path, never the raw query string.
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        userId: req.user?.id ?? null,
      }),
    );
  });

  next();
}
