import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/HttpError";

vi.mock("../utils/jwt", () => ({
  verifyToken: vi.fn(),
}));
vi.mock("../repositories/userRepository", () => ({
  userRepository: {
    findStatus: vi.fn(),
  },
}));
// Bypass the real TTL cache (a module-level singleton) so each test's
// findStatus mock actually gets hit instead of a prior test's cached result.
vi.mock("../lib/cache", () => ({
  getOrSet: vi.fn((_key: string, _ttlMs: number, fetcher: () => unknown) => fetcher()),
}));

import { verifyToken } from "../utils/jwt";
import { userRepository } from "../repositories/userRepository";
import { authenticate } from "./auth";

const decodedUser = { id: 1, username: "alice", name: "Alice", role: "SUPERVISOR_ADMIN" as const };

function makeReq(header?: string): Request {
  return { headers: { authorization: header } } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authenticate", () => {
  it("attaches req.user (with the DB's current role) when the token is valid and the user is active", async () => {
    vi.mocked(verifyToken).mockReturnValue(decodedUser);
    vi.mocked(userRepository.findStatus).mockResolvedValue({ isActive: true, role: "SUPERVISOR_ADMIN", tokenVersion: 0 } as never);

    const req = makeReq("Bearer good-token");
    const next = vi.fn();
    authenticate(req, {} as Response, next as NextFunction);

    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual(decodedUser);
  });

  it("rejects a token issued before the account's credentials were reset", async () => {
    vi.mocked(verifyToken).mockReturnValue({ ...decodedUser, tv: 0 });
    vi.mocked(userRepository.findStatus).mockResolvedValue({ isActive: true, role: "SUPERVISOR_ADMIN", tokenVersion: 1 } as never);

    const next = vi.fn();
    authenticate(makeReq("Bearer old-token"), {} as Response, next as NextFunction);

    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(401);
  });

  it("accepts a token carrying the current version, and a legacy token (no tv) while the version is still 0", async () => {
    vi.mocked(userRepository.findStatus).mockResolvedValue({ isActive: true, role: "SUPERVISOR_ADMIN", tokenVersion: 2 } as never);
    vi.mocked(verifyToken).mockReturnValue({ ...decodedUser, tv: 2 });
    const nextCurrent = vi.fn();
    authenticate(makeReq("Bearer t"), {} as Response, nextCurrent as NextFunction);
    await vi.waitFor(() => expect(nextCurrent).toHaveBeenCalled());
    expect(nextCurrent).toHaveBeenCalledWith();

    vi.mocked(userRepository.findStatus).mockResolvedValue({ isActive: true, role: "SUPERVISOR_ADMIN", tokenVersion: 0 } as never);
    vi.mocked(verifyToken).mockReturnValue(decodedUser);
    const nextLegacy = vi.fn();
    authenticate(makeReq("Bearer t"), {} as Response, nextLegacy as NextFunction);
    await vi.waitFor(() => expect(nextLegacy).toHaveBeenCalled());
    expect(nextLegacy).toHaveBeenCalledWith();
  });

  it("rejects with 401 when the user's account has since been deactivated", async () => {
    vi.mocked(verifyToken).mockReturnValue(decodedUser);
    vi.mocked(userRepository.findStatus).mockResolvedValue({ isActive: false, role: "SUPERVISOR_ADMIN" } as never);

    const req = makeReq("Bearer good-token");
    const next = vi.fn();
    authenticate(req, {} as Response, next as NextFunction);

    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(401);
  });

  it("rejects with 401 when the user has since been deleted", async () => {
    vi.mocked(verifyToken).mockReturnValue(decodedUser);
    vi.mocked(userRepository.findStatus).mockResolvedValue(null);

    const req = makeReq("Bearer good-token");
    const next = vi.fn();
    authenticate(req, {} as Response, next as NextFunction);

    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(next.mock.calls[0][0]).toBeInstanceOf(HttpError);
  });

  it("rejects with 401 without hitting the DB when the Authorization header is missing", async () => {
    const req = makeReq(undefined);
    const next = vi.fn();
    authenticate(req, {} as Response, next as NextFunction);

    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(next.mock.calls[0][0]).toBeInstanceOf(HttpError);
    expect(userRepository.findStatus).not.toHaveBeenCalled();
  });

  it("rejects with 401 when the token itself fails to verify", async () => {
    vi.mocked(verifyToken).mockImplementation(() => {
      throw new Error("jwt malformed");
    });

    const req = makeReq("Bearer bad-token");
    const next = vi.fn();
    authenticate(req, {} as Response, next as NextFunction);

    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(next.mock.calls[0][0]).toBeInstanceOf(HttpError);
    expect(userRepository.findStatus).not.toHaveBeenCalled();
  });
});
