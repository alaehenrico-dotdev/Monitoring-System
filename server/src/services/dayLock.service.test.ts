import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  dayClosure: { findUnique: vi.fn() },
}));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn() }));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));

import { assertPeriodOpen, runAsAdjustment } from "./dayLock.service";

const DATE = new Date("2026-10-12T00:00:00.000Z");

beforeEach(() => vi.clearAllMocks());

describe("assertPeriodOpen", () => {
  it("allows a day with no closure row", async () => {
    prismaMock.dayClosure.findUnique.mockResolvedValue(null);
    await expect(assertPeriodOpen(DATE, "MORNING")).resolves.toBeUndefined();
  });

  it("allows a day that was closed and then unlocked", async () => {
    prismaMock.dayClosure.findUnique.mockResolvedValue({ isClosed: false });
    await expect(assertPeriodOpen(DATE, "NIGHT")).resolves.toBeUndefined();
  });

  it("refuses a closed day with a 409 that names the way out", async () => {
    prismaMock.dayClosure.findUnique.mockResolvedValue({ isClosed: true });
    await expect(assertPeriodOpen(DATE, "NIGHT")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("2026-10-12"),
    });
  });

  it("lets an approved adjustment through a closed day", async () => {
    prismaMock.dayClosure.findUnique.mockResolvedValue({ isClosed: true });
    await expect(runAsAdjustment(() => assertPeriodOpen(DATE, "NIGHT"))).resolves.toBeUndefined();
  });
});
