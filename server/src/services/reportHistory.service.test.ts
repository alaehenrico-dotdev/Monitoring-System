import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = { fake: "tx" };
vi.mock("../lib/prisma", () => ({
  prisma: { $transaction: (fn: (t: unknown) => unknown) => fn(tx) },
}));
vi.mock("../repositories/changeLogRepository", () => ({ REPORTS_TABLE: "reports" }));
vi.mock("../repositories/reportHistoryRepository", () => ({
  reportHistoryRepository: { create: vi.fn(), findMany: vi.fn() },
}));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn() }));

import { reportHistoryRepository } from "../repositories/reportHistoryRepository";
import { recordChange } from "./changeLog.service";
import { recordReportHistory } from "./reportHistory.service";

beforeEach(() => vi.clearAllMocks());

describe("recordReportHistory", () => {
  it("also writes the report to the change log, in the same transaction", async () => {
    vi.mocked(reportHistoryRepository.create).mockResolvedValue({ id: 12 } as never);

    await recordReportHistory({ type: "Daily Report", scope: "2026-10-09", route: "/r", section: "online" }, 7);

    expect(reportHistoryRepository.create).toHaveBeenCalledWith(
      { type: "Daily Report", scope: "2026-10-09", route: "/r", section: "online", generatedById: 7 },
      tx,
    );
    expect(recordChange).toHaveBeenCalledWith(
      {
        tableName: "reports",
        recordId: 12,
        action: "CREATE",
        changedById: 7,
        newValue: { type: "Daily Report", scope: "2026-10-09", section: "online", route: "/r" },
      },
      tx,
    );
  });

  it("records a missing section as null", async () => {
    vi.mocked(reportHistoryRepository.create).mockResolvedValue({ id: 1 } as never);
    await recordReportHistory({ type: "Variance Report", scope: "2026-10-09", route: "/v" });
    expect(vi.mocked(recordChange).mock.calls[0][0].newValue).toMatchObject({ section: null });
  });
});
