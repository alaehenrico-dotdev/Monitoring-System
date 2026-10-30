import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/jwt", () => ({
  // A token is "ROLE:id:tokenVersion", so a test can sign in as anyone.
  verifyToken: vi.fn((token: string) => {
    const [role, id, tv] = token.split(":");
    return { id: Number(id), role, tv: Number(tv) };
  }),
}));
vi.mock("./cache", () => ({
  invalidatePrefix: vi.fn(),
  getOrSet: vi.fn((_key: string, _ttl: number, fetcher: () => unknown) => fetcher()),
}));
const accounts = vi.hoisted(() => new Map<number, { isActive: boolean; role: string; tokenVersion: number; mustChangePassword: boolean }>());
vi.mock("../repositories/userRepository", () => ({
  userRepository: { findStatus: vi.fn(async (id: number) => accounts.get(id) ?? null) },
}));

import { invalidatePrefix } from "./cache";
import { attachRealtime, broadcastNotice, broadcastRealtimeEvent, closeRealtime, revalidateClients } from "./realtime";

beforeEach(() => vi.clearAllMocks());

describe("broadcastRealtimeEvent", () => {
  it("drops the cached days-of-stock aggregate, so the dashboard tallies with the data that just changed", () => {
    broadcastRealtimeEvent();
    expect(invalidatePrefix).toHaveBeenCalledWith("days-of-stock:");
  });
});

describe("broadcastNotice", () => {
  let server: Server;
  const sockets: WebSocket[] = [];

  let nextId = 100;
  async function connect(role: string, tokenOverride?: string): Promise<{ ws: WebSocket; received: Record<string, unknown>[]; id: number; closed: Promise<number> }> {
    const id = nextId++;
    accounts.set(id, { isActive: true, role, tokenVersion: 0, mustChangePassword: false });
    const { port } = server.address() as AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.push(ws);
    const received: Record<string, unknown>[] = [];
    ws.on("message", (raw) => received.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));
    const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
    ws.send(JSON.stringify({ type: "auth", token: tokenOverride ?? `${role}:${id}:0` }));
    return { ws, received, id, closed };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

  beforeEach(async () => {
    server = createServer();
    attachRealtime(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterEach(async () => {
    closeRealtime();
    sockets.splice(0).forEach((s) => s.terminate());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reaches only the roles it is addressed to", async () => {
    const admin = await connect("SUPERVISOR_ADMIN");
    const encoder = await connect("ONLINE_ENCODER");
    await settle();
    broadcastNotice({ level: "success", message: "Backup saved" }, ["SUPERVISOR_ADMIN"]);
    await settle();
    expect(admin.received).toEqual([expect.objectContaining({ type: "notice", level: "success", message: "Backup saved" })]);
    expect(encoder.received).toEqual([]);
  });

  it("reaches everyone signed in when no roles are given", async () => {
    const admin = await connect("SUPERVISOR_ADMIN");
    const encoder = await connect("OFFLINE_ENCODER");
    await settle();
    broadcastNotice({ level: "info", message: "Hello" });
    await settle();
    expect(admin.received).toHaveLength(1);
    expect(encoder.received).toHaveLength(1);
  });

  it("refuses a token for an account that is deactivated, signed out everywhere, or must change its password", async () => {
    const deactivated = await connect("SUPERVISOR_ADMIN");
    accounts.set(deactivated.id, { isActive: false, role: "SUPERVISOR_ADMIN", tokenVersion: 0, mustChangePassword: false });
    const stale = await connect("SUPERVISOR_ADMIN", "SUPERVISOR_ADMIN:555:0");
    accounts.set(555, { isActive: true, role: "SUPERVISOR_ADMIN", tokenVersion: 1, mustChangePassword: false });
    const forced = await connect("SUPERVISOR_ADMIN", "SUPERVISOR_ADMIN:556:0");
    accounts.set(556, { isActive: true, role: "SUPERVISOR_ADMIN", tokenVersion: 0, mustChangePassword: true });
    await settle();
    broadcastNotice({ level: "error", message: "secret" });
    await settle();
    for (const c of [deactivated, stale, forced]) expect(c.received).toEqual([]);
    expect(await Promise.all([deactivated.closed, stale.closed, forced.closed])).toEqual([4001, 4001, 4001]);
  });

  it("uses the account's current role, not the one frozen in the token", async () => {
    const admin = await connect("ONLINE_ENCODER", "SUPERVISOR_ADMIN:900:0");
    accounts.set(900, { isActive: true, role: "ONLINE_ENCODER", tokenVersion: 0, mustChangePassword: false });
    await settle();
    broadcastNotice({ level: "success", message: "Backup saved" }, ["SUPERVISOR_ADMIN"]);
    await settle();
    expect(admin.received).toEqual([]);
  });

  it("drops a connected socket once its account is signed out or deactivated", async () => {
    const kept = await connect("ONLINE_ENCODER");
    const revoked = await connect("SUPERVISOR_ADMIN");
    const demoted = await connect("SUPERVISOR_ADMIN");
    await settle();
    accounts.set(revoked.id, { isActive: true, role: "SUPERVISOR_ADMIN", tokenVersion: 1, mustChangePassword: false }); // signed out everywhere
    accounts.set(demoted.id, { isActive: true, role: "ONLINE_ENCODER", tokenVersion: 0, mustChangePassword: false });
    await revalidateClients();
    expect(await revoked.closed).toBe(4001);
    expect(kept.ws.readyState).toBe(WebSocket.OPEN);
    broadcastNotice({ level: "info", message: "admins only" }, ["SUPERVISOR_ADMIN"]);
    await settle();
    expect(demoted.received).toEqual([]);
  });

  it("never reaches a connection that has not signed in", async () => {
    const { port } = server.address() as AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.push(ws);
    const received: unknown[] = [];
    ws.on("message", (raw) => received.push(raw.toString()));
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));
    broadcastNotice({ level: "error", message: "secret" });
    await settle();
    expect(received).toEqual([]);
  });
});
