import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/jwt", () => ({
  // The token is just the role, so a test can sign in as anyone.
  verifyToken: vi.fn((token: string) => ({ id: 1, role: token })),
}));
vi.mock("./cache", () => ({ invalidatePrefix: vi.fn() }));

import { invalidatePrefix } from "./cache";
import { attachRealtime, broadcastNotice, broadcastRealtimeEvent, closeRealtime } from "./realtime";

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

  async function connect(role: string): Promise<{ ws: WebSocket; received: Record<string, unknown>[] }> {
    const { port } = server.address() as AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.push(ws);
    const received: Record<string, unknown>[] = [];
    ws.on("message", (raw) => received.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));
    ws.send(JSON.stringify({ type: "auth", token: role }));
    return { ws, received };
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
