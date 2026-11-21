import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const manual = vi.hoisted(() => ({ publishManualCounts: vi.fn() }));
vi.mock("../services/manualCounts.service", () => ({
  MAX_REMARKS_LENGTH: 500,
  MAX_SNAPSHOT_STATES: 100,
  deleteManualCount: vi.fn(),
  getManualCountGrid: vi.fn(),
  getSystemRemainingStock: vi.fn(),
  getVarianceReport: vi.fn(),
  getVarianceTrace: vi.fn(),
  getAuditSnapshot: vi.fn(),
  getAuditSnapshotStates: vi.fn(),
  revertAuditSnapshot: vi.fn(),
  saveManualCount: vi.fn(),
  setCountRemarks: vi.fn(),
  publishManualCounts: manual.publishManualCounts,
}));
vi.mock("../services/aiExplain.service", () => ({ explainVariance: vi.fn() }));
const guard = vi.hoisted(() => ({ draftsBlockingPublish: vi.fn() }));
vi.mock("../services/countSubmission.service", () => guard);

import { postPublish } from "./manualCounts.controller";

const publish = (body: Record<string, unknown>) =>
  postPublish({ query: { date: "2026-11-21", shift: "NIGHT" }, body, user: { id: 1 } } as unknown as Request, { json: vi.fn() } as unknown as Response);

beforeEach(() => {
  vi.clearAllMocks();
  manual.publishManualCounts.mockResolvedValue({ published: 3 });
  guard.draftsBlockingPublish.mockResolvedValue([]);
});

describe("publishing while an auditor has not submitted", () => {
  it("publishes as before when no auditor has unsubmitted counts", async () => {
    await publish({ applyToOpening: true });
    expect(manual.publishManualCounts).toHaveBeenCalledWith(new Date("2026-11-21T00:00:00Z"), "NIGHT", 1, true);
  });

  it("stops with a 409 naming them, and publishes nothing", async () => {
    guard.draftsBlockingPublish.mockResolvedValue([{ auditor: "Ben", counted: 12 }]);
    const err = await publish({ applyToOpening: true }).catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/Ben has counts typed but not submitted/);
    expect(err.details).toEqual({ auditorDrafts: [{ auditor: "Ben", counted: 12 }] });
    expect(manual.publishManualCounts).not.toHaveBeenCalled();
  });

  it("names two auditors in the plural", async () => {
    guard.draftsBlockingPublish.mockResolvedValue([{ auditor: "Ana", counted: 1 }, { auditor: "Ben", counted: 2 }]);
    const err = await publish({}).catch((e) => e);
    expect(err.message).toMatch(/Ana and Ben have counts typed/);
  });

  it("goes ahead once the admin has acknowledged it", async () => {
    guard.draftsBlockingPublish.mockResolvedValue([{ auditor: "Ben", counted: 12 }]);
    await publish({ applyToOpening: false, acknowledgeAuditorDrafts: true });
    expect(manual.publishManualCounts).toHaveBeenCalledWith(new Date("2026-11-21T00:00:00Z"), "NIGHT", 1, false);
  });
});
