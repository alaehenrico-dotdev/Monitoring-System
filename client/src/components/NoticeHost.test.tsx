import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NoticeHost } from "./NoticeHost";
import { notify, subscribeNotices } from "../utils/notify";

afterEach(() => {
  // Each test mounts its own host; nothing is left subscribed between them.
});

describe("notify / NoticeHost", () => {
  it("shows a notice as a toast, and several at once", () => {
    render(<NoticeHost />);
    act(() => notify({ level: "success", message: "Google Drive backup saved: a.sql.gz (3.0 MB)." }));
    act(() => notify({ level: "success", message: "Daily Report for 2026-10-22 saved to Google Drive." }));
    expect(screen.getByText(/backup saved: a\.sql\.gz/)).toBeInTheDocument();
    expect(screen.getByText(/Daily Report for 2026-10-22 saved/)).toBeInTheDocument();
  });

  it("keeps an error up until it is closed, and a success does not need closing", () => {
    render(<NoticeHost />);
    act(() => notify({ level: "error", message: "The scheduled Google Drive backup failed: Quota exceeded" }));
    expect(screen.getByText(/Quota exceeded/)).toBeInTheDocument();
  });

  it("shows no more than four at a time, newest last", () => {
    render(<NoticeHost />);
    for (let i = 1; i <= 6; i++) act(() => notify({ level: "info", message: `Notice ${i}` }));
    expect(screen.queryByText("Notice 1")).toBeNull();
    expect(screen.queryByText("Notice 2")).toBeNull();
    expect(screen.getByText("Notice 3")).toBeInTheDocument();
    expect(screen.getByText("Notice 6")).toBeInTheDocument();
  });

  it("stops listening when it is removed", () => {
    const seen: string[] = [];
    const off = subscribeNotices((n) => seen.push(n.message));
    notify({ level: "info", message: "one" });
    off();
    notify({ level: "info", message: "two" });
    expect(seen).toEqual(["one"]);
  });
});
