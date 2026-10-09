import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { errorHandler, notFoundHandler } from "./errorHandler";
import { HttpError } from "../utils/HttpError";

function makeReq(overrides: Partial<Request> = {}): Request {
  return { method: "POST", path: "/api/online-stock", id: "req-123", ...overrides } as Request;
}

/// Captures what the handler sent, the way Express's res.status().json() chains.
function makeRes() {
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, sent };
}

const next = (() => {}) as NextFunction;

function prismaKnown(code: string) {
  return new Prisma.PrismaClientKnownRequestError("internal prisma text", {
    code,
    clientVersion: "6.19.3",
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe("notFoundHandler", () => {
  it("returns 404 naming the route that missed", () => {
    const { res, sent } = makeRes();
    notFoundHandler(makeReq({ method: "GET", path: "/api/nope" }), res);

    expect(sent.status).toBe(404);
    expect(sent.body).toEqual({ error: "No route for GET /api/nope" });
  });
});

describe("errorHandler - HttpError passthrough", () => {
  it("keeps the status, message and details of a deliberate HttpError", () => {
    const { res, sent } = makeRes();
    errorHandler(HttpError.badRequest("Invalid query", { field: "date" }), makeReq(), res, next);

    expect(sent.status).toBe(400);
    expect(sent.body).toMatchObject({ error: "Invalid query", details: { field: "date" } });
  });

  it("attaches the request id so a user can quote it", () => {
    const { res, sent } = makeRes();
    errorHandler(HttpError.notFound("Gone"), makeReq(), res, next);
    expect(sent.body).toMatchObject({ requestId: "req-123" });
  });

  it("does not log a 4xx as an incident", () => {
    const { res } = makeRes();
    errorHandler(HttpError.unauthorized(), makeReq(), res, next);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("does log a deliberate 5xx", () => {
    const { res } = makeRes();
    errorHandler(new HttpError(503, "Down"), makeReq(), res, next);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

describe("errorHandler - Prisma mapping", () => {
  it("maps a unique-constraint violation to 409, not 500", () => {
    // Two encoders saving the same (productId, entryDate, shift) - the user
    // lost a race, they did not hit a bug.
    const { res, sent } = makeRes();
    errorHandler(prismaKnown("P2002"), makeReq(), res, next);

    expect(sent.status).toBe(409);
    expect(sent.body).toMatchObject({ error: expect.stringContaining("changed by someone else") });
  });

  it("maps a foreign-key violation to 400", () => {
    const { res, sent } = makeRes();
    errorHandler(prismaKnown("P2003"), makeReq(), res, next);
    expect(sent.status).toBe(400);
  });

  it("maps a missing record to 404", () => {
    const { res, sent } = makeRes();
    errorHandler(prismaKnown("P2025"), makeReq(), res, next);
    expect(sent.status).toBe(404);
  });

  it("maps an exhausted write conflict to a retryable 503", () => {
    // serializableTransaction retries P2034 itself; reaching here means it
    // ran out of attempts, which is a busy server, not a broken one.
    const { res, sent } = makeRes();
    errorHandler(prismaKnown("P2034"), makeReq(), res, next);
    expect(sent.status).toBe(503);
  });

  it("maps a database that won't connect to 503", () => {
    const { res, sent } = makeRes();
    const err = new Prisma.PrismaClientInitializationError("can't reach db", "6.19.3");
    errorHandler(err, makeReq(), res, next);
    expect(sent.status).toBe(503);
  });

  it("leaves an unrecognised Prisma code as a 500 rather than guessing", () => {
    const { res, sent } = makeRes();
    errorHandler(prismaKnown("P1234"), makeReq(), res, next);
    expect(sent.status).toBe(500);
    expect(sent.body).toMatchObject({ error: "Internal server error" });
  });

  it("never leaks Prisma's own message, which names tables and columns", () => {
    const { res, sent } = makeRes();
    errorHandler(prismaKnown("P2002"), makeReq(), res, next);
    expect(JSON.stringify(sent.body)).not.toContain("internal prisma text");
  });
});

describe("errorHandler - unexpected errors", () => {
  it("returns a generic 500 and never the real message", () => {
    const { res, sent } = makeRes();
    errorHandler(new Error("connect ECONNREFUSED 10.0.0.5:3306 user=root"), makeReq(), res, next);

    expect(sent.status).toBe(500);
    expect(sent.body).toEqual({ error: "Internal server error", requestId: "req-123" });
    expect(JSON.stringify(sent.body)).not.toContain("ECONNREFUSED");
  });

  it("logs one structured line carrying the stack and the request id", () => {
    const { res } = makeRes();
    errorHandler(new Error("boom"), makeReq({ user: { id: 42 } as never }), res, next);

    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      level: "error",
      requestId: "req-123",
      method: "POST",
      path: "/api/online-stock",
      status: 500,
      userId: 42,
      message: "boom",
    });
    expect(logged.stack).toContain("boom");
  });

  it("survives a thrown non-Error without crashing the handler", () => {
    const { res, sent } = makeRes();
    expect(() => errorHandler("just a string", makeReq(), res, next)).not.toThrow();
    expect(sent.status).toBe(500);
  });
});
