import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => ({ prisma: {} }));
vi.mock("./actionQueue.service", () => ({ getActionQueue: vi.fn(), localToday: vi.fn() }));

import { buildPushMessage, newUrgent, type AlertItem } from "./alerts.service";

const item = (id: string, severity: AlertItem["severity"], title = id, link = "/x"): AlertItem => ({ id, kind: "low-stock", severity, title, detail: "", link });

describe("newUrgent", () => {
  it("returns only high-severity problems not announced before", () => {
    const items = [item("a", "high"), item("b", "high"), item("c", "medium")];
    expect(newUrgent(items, new Set(["a"])).map((i) => i.id)).toEqual(["b"]);
  });

  it("is empty when everything urgent was already announced", () => {
    expect(newUrgent([item("a", "high")], new Set(["a"]))).toEqual([]);
  });
});

describe("buildPushMessage", () => {
  it("links straight to the record when there is one problem", () => {
    const m = buildPushMessage([item("a", "high", "Sauce - negative (-2)", "/total-stocks")]);
    expect(m).toEqual({ title: "Needs attention", body: "Sauce - negative (-2)", url: "/total-stocks" });
  });

  it("summarises several and opens the Admin Queue", () => {
    const m = buildPushMessage(["a", "b", "c", "d", "e"].map((id) => item(id, "high")));
    expect(m.title).toBe("5 things need attention");
    expect(m.body).toBe("a; b; c +2 more");
    expect(m.url).toBe("/admin-queue");
  });
});
