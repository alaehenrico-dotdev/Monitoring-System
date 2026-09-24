import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/changeLogRepository", () => ({
  changeLogRepository: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
}));

import { changeLogRepository } from "../repositories/changeLogRepository";
import { listChangeLog, recordChange } from "./changeLog.service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordChange", () => {
  it("forwards the change to the repository, defaulting db to the shared prisma client", async () => {
    vi.mocked(changeLogRepository.create).mockResolvedValue({} as never);

    await recordChange({ tableName: "products", recordId: 1, action: "UPDATE", changedById: 7, oldValue: { a: 1 }, newValue: { a: 2 } });

    expect(changeLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "products", recordId: 1, action: "UPDATE", changedById: 7 }),
      expect.anything(),
    );
  });

  it("passes through an explicit transaction client instead of the default", async () => {
    vi.mocked(changeLogRepository.create).mockResolvedValue({} as never);
    const tx = { fake: "transaction-client" } as never;

    await recordChange({ tableName: "receipts", recordId: 10, action: "CREATE" }, tx);

    expect(changeLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({ tableName: "receipts" }), tx);
  });
});

describe("listChangeLog", () => {
  it("delegates the filters straight through to the repository", async () => {
    vi.mocked(changeLogRepository.findMany).mockResolvedValue([]);

    await listChangeLog({ tableName: "products", recordId: 1 });

    expect(changeLogRepository.findMany).toHaveBeenCalledWith({ tableName: "products", recordId: 1 });
  });
});
