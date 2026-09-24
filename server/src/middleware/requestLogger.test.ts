import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { requestLogger } from "./requestLogger";

function makeRes(statusCode: number): Response {
  const res = new EventEmitter() as unknown as Response;
  (res as unknown as { statusCode: number }).statusCode = statusCode;
  return res;
}

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

describe("requestLogger", () => {
  it("calls next immediately without logging", () => {
    const req = { method: "GET", originalUrl: "/api/products" } as Request;
    const res = makeRes(200);
    const next = vi.fn();

    requestLogger(req, res, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("logs a structured JSON line with method/path/status/duration/userId once the response finishes", () => {
    const req = { method: "POST", originalUrl: "/api/receipts", user: { id: 7 } } as Request;
    const res = makeRes(201);

    requestLogger(req, res, vi.fn() as NextFunction);
    res.emit("finish");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ method: "POST", path: "/api/receipts", status: 201, userId: 7 });
    expect(typeof logged.durationMs).toBe("number");
  });

  it("logs userId: null for an unauthenticated request", () => {
    const req = { method: "GET", originalUrl: "/health" } as Request;
    const res = makeRes(200);

    requestLogger(req, res, vi.fn() as NextFunction);
    res.emit("finish");

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged.userId).toBeNull();
  });
});
