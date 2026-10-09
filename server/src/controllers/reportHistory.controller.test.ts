import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const listReportHistory = vi.fn();
vi.mock("../services/reportHistory.service", () => ({
  listReportHistory: (...a: unknown[]) => listReportHistory(...a),
  recordReportHistory: vi.fn(),
}));

import { getReportHistory } from "./reportHistory.controller";

function call(role: string, type?: string) {
  const json = vi.fn();
  const req = {
    user: { id: 1, role },
    query: type ? { type } : {},
  } as unknown as Request;
  const res = { json } as unknown as Response;
  return { run: () => getReportHistory(req, res), json };
}

describe("GET /report-history access", () => {
  beforeEach(() => listReportHistory.mockReset().mockResolvedValue([]));

  it("lets any role read Audit Report history", async () => {
    for (const role of [
      "ONLINE_ENCODER",
      "OFFLINE_ENCODER",
      "SUPERVISOR_ADMIN",
    ]) {
      const c = call(role, "Audit Report");
      await c.run();
      expect(c.json).toHaveBeenCalledWith([]);
    }
    expect(listReportHistory).toHaveBeenCalledWith("Audit Report");
  });

  it("keeps Daily and Variance history Supervisor/Admin only", async () => {
    for (const type of ["Daily Report", "Variance Report", undefined]) {
      await expect(call("ONLINE_ENCODER", type).run()).rejects.toMatchObject({
        status: 403,
      });
    }
    const admin = call("SUPERVISOR_ADMIN", "Variance Report");
    await admin.run();
    expect(admin.json).toHaveBeenCalled();
  });
});
