import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { HttpError } from "../utils/HttpError";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}

/**
 * Maps the Prisma errors this app can actually provoke onto the HTTP status
 * the client can act on.
 *
 * Without this they all fell through to a blanket 500 "Internal server
 * error", which is wrong in both directions: it tells the user a bug
 * occurred when in fact they lost a race (two encoders saving the same
 * product/date/shift), and it hides a genuine constraint problem from the
 * client that could have retried or re-read.
 *
 * Deliberately narrow. Only codes with an unambiguous, safe client-facing
 * meaning are translated; anything else stays a 500 and gets logged with a
 * stack, because guessing a status for an unfamiliar database failure is how
 * a real outage gets reported to users as a validation error.
 *
 * Messages here never include Prisma's own text - that embeds table and
 * column names, which is internal schema detail the client has no business
 * seeing.
 */
function fromPrisma(err: unknown): HttpError | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        // Unique constraint. On this schema that is almost always the
        // (productId, entryDate, shift) key - i.e. a concurrent save.
        return HttpError.conflict(
          "That record was changed by someone else just now - reload and try again.",
        );
      case "P2003":
        // Foreign key constraint - referencing a product/user that no longer
        // exists, typically after a deactivation or a data reset.
        return HttpError.badRequest(
          "That record refers to something that no longer exists - reload and try again.",
        );
      case "P2025":
        return HttpError.notFound("That record no longer exists.");
      case "P2034":
        // A write conflict that outlived serializableTransaction's own
        // retries (lib/prisma.ts). Retryable by the client, not a bug.
        return new HttpError(
          503,
          "The server is busy with another change to the same record - please try again.",
        );
      default:
        return null;
    }
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    // A malformed query built from user input that got past zod. A 400 is
    // honest about whose fault it is, and the detail stays in the log.
    return HttpError.badRequest("That request wasn't valid.");
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return new HttpError(503, "The database is unavailable - please try again shortly.");
  }
  return null;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const mapped = err instanceof HttpError ? err : fromPrisma(err);

  if (mapped) {
    // Expected failures (validation, auth, 404, lost race) are not incidents.
    // Logged at one line without a stack so they don't drown the real ones,
    // and only from 500 up do they get the full treatment below.
    if (mapped.status >= 500) logUnexpected(err, req, mapped.status);
    res.status(mapped.status).json({
      error: mapped.message,
      details: mapped.details,
      requestId: req.id,
    });
    return;
  }

  logUnexpected(err, req, 500);
  // Never the real message: an unhandled error's text routinely carries SQL,
  // file paths or connection strings. The requestId is how support ties this
  // response back to the logged stack.
  res.status(500).json({ error: "Internal server error", requestId: req.id });
}

/// One structured JSON line, same shape as the access log in
/// middleware/requestLogger.ts so both can be parsed by the same tooling and
/// joined on requestId.
function logUnexpected(err: unknown, req: Request, status: number) {
  console.error(
    JSON.stringify({
      level: "error",
      requestId: req.id,
      method: req.method,
      path: req.path,
      status,
      userId: req.user?.id ?? null,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
      code: (err as { code?: unknown })?.code ?? null,
      stack: err instanceof Error ? err.stack : null,
    }),
  );
}
