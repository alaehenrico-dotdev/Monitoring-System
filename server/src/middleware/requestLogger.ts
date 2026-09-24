import type { NextFunction, Request, Response } from "express";

/// Logs one structured JSON line per request (method, path, status,
/// duration, and the authenticated user id if any) so a request can be
/// traced end to end in production. Listens on "finish" rather than logging
/// up front, so it fires after the whole pipeline - by then req.user is
/// populated if authenticate ran for this route. Purely additive: doesn't
/// touch HttpError/errorHandler.ts at all.
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(
      JSON.stringify({
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        userId: req.user?.id ?? null,
      }),
    );
  });

  next();
}
