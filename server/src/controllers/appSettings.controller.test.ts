import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../services/appSettings.service", () => ({
  getEntryRules: vi.fn().mockResolvedValue({ requireEarlierDaysFinished: true }),
  setEntryRules: vi.fn(),
}));

import { getEntryRules, setEntryRules } from "../services/appSettings.service";
import { getEntryRulesHandler, patchEntryRulesHandler } from "./appSettings.controller";

const call = <T>(handler: (req: Request, res: Response) => T, body: unknown = {}) => {
  const res = { json: vi.fn() };
  const req = { user: { id: 7, role: "SUPERVISOR_ADMIN" }, body } as unknown as Request;
  return { res, done: Promise.resolve(handler(req, res as unknown as Response)) };
};

beforeEach(() => vi.clearAllMocks());

describe("entry rules endpoints", () => {
  it("returns the current rules", async () => {
    const { res, done } = call(getEntryRulesHandler);
    await done;
    expect(getEntryRules).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ requireEarlierDaysFinished: true });
  });

  it("applies a valid change as the signed-in admin and returns the result", async () => {
    vi.mocked(setEntryRules).mockResolvedValue({ requireEarlierDaysFinished: false, useShifts: true });
    const { res, done } = call(patchEntryRulesHandler, { requireEarlierDaysFinished: false });
    await done;
    expect(setEntryRules).toHaveBeenCalledWith({ requireEarlierDaysFinished: false }, 7);
    expect(res.json).toHaveBeenCalledWith({ requireEarlierDaysFinished: false, useShifts: true });
  });

  it.each([
    ["a string where a switch belongs", { requireEarlierDaysFinished: "false" }],
    ["a number", { requireEarlierDaysFinished: 0 }],
    ["a setting that does not exist", { somethingElse: true }],
    ["nothing at all", {}],
    ["no body", undefined],
  ])("rejects %s without changing anything", async (_label, body) => {
    const { done } = call(patchEntryRulesHandler, body);
    await expect(done).rejects.toThrow(/Invalid entry rules/);
    expect(setEntryRules).not.toHaveBeenCalled();
  });
});
