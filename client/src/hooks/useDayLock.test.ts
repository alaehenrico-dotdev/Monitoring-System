import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { DayStatus } from "../api/ops";

const api = vi.hoisted(() => ({ getDayStatus: vi.fn() }));
vi.mock("../api/ops", () => api);

import { useDayLock } from "./useDayLock";

const blocker = { entryDate: "2026-10-09", shift: "NIGHT" as const };
const status = (over: Partial<DayStatus> = {}): DayStatus => ({
  entryDate: "2026-10-14",
  shift: "NIGHT",
  isClosed: false,
  locked: false,
  onlineLocked: false,
  offlineLocked: false,
  closure: null,
  blockedBy: null,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

async function lock(s: DayStatus | Error) {
  if (s instanceof Error) api.getDayStatus.mockRejectedValue(s);
  else api.getDayStatus.mockResolvedValue(s);
  const hook = renderHook(() => useDayLock("2026-10-14", "NIGHT", 0, "ONLINE"));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  return hook.result.current;
}

describe("useDayLock - entering versus finishing", () => {
  it("blocks entering and finishing alike while days must be finished in order", async () => {
    const l = await lock(status({ blockedBy: blocker, entryBlockedBy: blocker }));
    expect(l.blockedBy).toEqual(blocker);
    expect(l.entryBlockedBy).toEqual(blocker);
  });

  it("lets the sheet be entered, but still holds back Finish, when the admin turned the rule off", async () => {
    const l = await lock(status({ blockedBy: blocker, entryBlockedBy: null }));
    expect(l.entryBlockedBy).toBeNull();
    expect(l.blockedBy).toEqual(blocker);
  });

  it("treats a server that sends no entry answer as before: entering is blocked by the same day", async () => {
    const l = await lock(status({ blockedBy: blocker }));
    expect(l.entryBlockedBy).toEqual(blocker);
  });

  it("blocks nothing when no earlier day is open", async () => {
    const l = await lock(status());
    expect(l.blockedBy).toBeNull();
    expect(l.entryBlockedBy).toBeNull();
  });

  it("never blocks editing on a failed status lookup - the server still refuses a bad save itself", async () => {
    const l = await lock(new Error("offline"));
    expect(l.locked).toBe(false);
    expect(l.blockedBy).toBeNull();
    expect(l.entryBlockedBy).toBeNull();
  });
});
