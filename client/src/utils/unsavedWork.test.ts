import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  countAllUnsavedWork,
  findAllUnsavedWork,
  findUnsavedWork,
  ENTRY_PREFIX,
  MANUAL_COUNT_PREFIX,
} from "./unsavedWork";

/// Staged edits are stored as { productId: { column: value } } (entry pages)
/// or { productId: draft } (manual count) - only the key count matters here.
function stage(key: string, productIds: number[]) {
  sessionStorage.setItem(
    key,
    JSON.stringify(Object.fromEntries(productIds.map((id) => [id, { stockIn: 1 }]))),
  );
}

beforeEach(() => sessionStorage.clear());

describe("findAllUnsavedWork", () => {
  it("finds nothing in a clean session", () => {
    expect(findAllUnsavedWork()).toEqual([]);
    expect(countAllUnsavedWork()).toBe(0);
  });

  it("finds staged edits on every entry page", () => {
    stage(`${ENTRY_PREFIX}online:2026-10-09:NIGHT`, [1, 2, 3]);
    stage(`${ENTRY_PREFIX}offline:2026-10-09:MORNING`, [4]);
    stage(`${MANUAL_COUNT_PREFIX}2026-10-09:NIGHT:ONLINE`, [5, 6]);

    const found = findAllUnsavedWork();

    expect(found.map((f) => f.page).sort()).toEqual([
      "Manual Count",
      "Offline Entry",
      "Online Entry",
    ]);
    expect(countAllUnsavedWork()).toBe(6);
  });

  it("reports the page, date, shift and count the warning shows", () => {
    stage(`${ENTRY_PREFIX}online:2026-10-09:NIGHT`, [1, 2]);

    expect(findAllUnsavedWork()[0]).toMatchObject({
      page: "Online Entry",
      route: "/online",
      date: "2026-10-09",
      shift: "Night",
      count: 2,
    });
  });

  it("carries the location for a manual count, which has two per shift", () => {
    stage(`${MANUAL_COUNT_PREFIX}2026-10-09:NIGHT:OFFLINE`, [1]);
    expect(findAllUnsavedWork()[0]).toMatchObject({
      page: "Manual Count",
      location: "Offline",
    });
  });

  it("ignores an empty staged set left behind after saving", () => {
    // The entry pages remove the key when the last edit is saved, but a
    // stale "{}" must not make Logout claim there is work to lose.
    sessionStorage.setItem(`${ENTRY_PREFIX}online:2026-10-09:NIGHT`, "{}");
    expect(findAllUnsavedWork()).toEqual([]);
  });

  it("ignores unrelated session keys", () => {
    sessionStorage.setItem("ala-eh-focus:online:2026-10-09:NIGHT", "12");
    sessionStorage.setItem("something-else", "whatever");
    expect(findAllUnsavedWork()).toEqual([]);
  });

  it("survives malformed stored JSON rather than breaking logout", () => {
    sessionStorage.setItem(`${ENTRY_PREFIX}online:2026-10-09:NIGHT`, "{not json");
    expect(() => findAllUnsavedWork()).not.toThrow();
    expect(findAllUnsavedWork()).toEqual([]);
  });

  it("finds work on ANY date, unlike the date-scoped report check", () => {
    // This is the whole reason findAllUnsavedWork exists: a report only
    // cares about its own dates, but logging out abandons everything.
    stage(`${ENTRY_PREFIX}online:2019-01-01:NIGHT`, [1]);
    stage(`${ENTRY_PREFIX}offline:2099-12-31:MORNING`, [2]);

    expect(findAllUnsavedWork()).toHaveLength(2);
    // The same edits are invisible to a report covering only today.
    expect(findUnsavedWork({ from: "2026-10-09", to: "2026-10-09" })).toEqual([]);
  });

  it("returns nothing when session storage is unavailable", () => {
    const spy = vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new Error("blocked site data");
    });
    stage(`${ENTRY_PREFIX}online:2026-10-09:NIGHT`, [1]);

    expect(findAllUnsavedWork()).toEqual([]);
    spy.mockRestore();
  });
});
