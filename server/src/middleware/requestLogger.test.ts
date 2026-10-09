import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { requestLogger } from "./requestLogger";

/// A minimal stand-in for Express's Response: an EventEmitter (so "finish"
/// can be fired) plus the few members requestLogger actually touches.
/// setHeader is captured rather than ignored so the correlation header can
/// be asserted on.
function makeRes(statusCode: number): Response & { headers: Record<string, unknown> } {
  const res = new EventEmitter() as unknown as Response & { headers: Record<string, unknown> };
  res.headers = {};
  (res as unknown as { statusCode: number }).statusCode = statusCode;
  (res as unknown as { setHeader: (k: string, v: unknown) => void }).setHeader = (k, v) => {
    res.headers[k] = v;
  };
  return res;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

describe("requestLogger", () => {
  it("calls next immediately without logging", () => {
    const req = { method: "GET", originalUrl: "/api/products", path: "/api/products" } as Request;
    const res = makeRes(200);
    const next = vi.fn();

    requestLogger(req, res, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("logs a structured JSON line with method/path/status/duration/userId once the response finishes", () => {
    const req = { method: "POST", originalUrl: "/api/receipts", path: "/api/receipts", user: { id: 7 } } as Request;
    const res = makeRes(201);

    requestLogger(req, res, vi.fn() as NextFunction);
    res.emit("finish");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ method: "POST", path: "/api/receipts", status: 201, userId: 7 });
    expect(typeof logged.durationMs).toBe("number");
  });

  it("logs userId: null for an unauthenticated request", () => {
    const req = { method: "GET", originalUrl: "/health", path: "/health" } as Request;
    const res = makeRes(200);

    requestLogger(req, res, vi.fn() as NextFunction);
    res.emit("finish");

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged.userId).toBeNull();
  });
});

describe("requestLogger - correlation id", () => {
  it("assigns a uuid request id and echoes it as X-Request-Id", () => {
    const req = { method: "GET", path: "/api/products" } as Request;
    const res = makeRes(200);

    requestLogger(req, res, (() => {}) as NextFunction);

    expect(req.id).toMatch(UUID_RE);
    expect(res.headers["X-Request-Id"]).toBe(req.id);
  });

  it("includes the request id in the access log line", () => {
    const req = { method: "GET", path: "/api/products" } as Request;
    const res = makeRes(200);

    requestLogger(req, res, (() => {}) as NextFunction);
    res.emit("finish");

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged.requestId).toBe(req.id);
  });

  it("gives each request its own id", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const req = { method: "GET", path: "/api/products" } as Request;
      requestLogger(req, makeRes(200), (() => {}) as NextFunction);
      ids.add(req.id!);
    }
    expect(ids.size).toBe(5);
  });

  it("ignores any client-supplied request id rather than trusting it", () => {
    // A forged or repeated inbound id would let a caller poison the logs by
    // colliding with someone else's request.
    const req = {
      method: "GET",
      path: "/api/products",
      headers: { "x-request-id": "attacker-controlled" },
    } as unknown as Request;

    requestLogger(req, makeRes(200), (() => {}) as NextFunction);

    expect(req.id).not.toBe("attacker-controlled");
    expect(req.id).toMatch(UUID_RE);
  });
});
