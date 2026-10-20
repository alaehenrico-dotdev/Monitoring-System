import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VersionHistoryPanel } from "./VersionHistoryPanel";

const api = vi.hoisted(() => ({
  getSheetVersions: vi.fn(),
  getSheetVersion: vi.fn(),
  getSheetPublishes: vi.fn(),
  restoreSheetVersion: vi.fn(),
}));
vi.mock("../api/changeLog", () => api);
vi.mock("../context/RealtimeContext", () => ({ useRealtimeVersion: () => 0 }));

const version = (upTo: number, after: number) => ({
  upTo,
  after,
  startedAt: "2026-10-19T10:00:00.000Z",
  endedAt: "2026-10-19T10:05:00.000Z",
  user: { id: 1, name: "Ana" },
  changes: 2,
  products: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Newest first: version 20 is the current sheet, 10 is the older one.
  api.getSheetVersions.mockResolvedValue({ versions: [version(20, 10), version(10, 0)] });
  api.getSheetVersion.mockImplementation((_s, _d, _sh, upTo: number) =>
    Promise.resolve({ upTo, after: 0, rows: [{ recordId: 1, productId: 7, sku: "A1", name: "APPLE", values: { productionIn: "3.00" }, changed: [] }] }),
  );
  api.restoreSheetVersion.mockResolvedValue({ restored: 1, held: 0, skipped: 0 });
});

function open(sheet: "online" | "manual" = "online") {
  render(<VersionHistoryPanel sheet={sheet} date="2026-10-19" shift="NIGHT" onClose={vi.fn()} />);
}

describe("VersionHistoryPanel restore", () => {
  it("cannot restore the latest version, which already is the sheet", async () => {
    open();
    const button = (await screen.findByRole("button", { name: "Restore this version" })) as HTMLButtonElement;
    await waitFor(() => expect(api.getSheetVersion).toHaveBeenCalled());
    expect(button.disabled).toBe(true);
  });

  it("confirms, then restores the picked older version", async () => {
    open();
    const entries = await screen.findAllByRole("button", { name: /Ana/ });
    fireEvent.click(entries[1]);
    await waitFor(() => expect(api.getSheetVersion).toHaveBeenCalledWith("online", "2026-10-19", "NIGHT", 10, 0));
    await screen.findByText("APPLE");
    const button = screen.getByRole("button", { name: "Restore this version" }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);

    // Nothing is written until the confirmation is accepted.
    expect(api.restoreSheetVersion).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.restoreSheetVersion).toHaveBeenCalledWith("online", "2026-10-19", "NIGHT", 10));
    expect(await screen.findByText(/1 product written back/)).toBeTruthy();
  });

  it("shows the server's reason when the restore fails", async () => {
    api.restoreSheetVersion.mockRejectedValue(new Error("Online is finished for this shift"));
    open();
    const entries = await screen.findAllByRole("button", { name: /Ana/ });
    fireEvent.click(entries[1]);
    await screen.findByText("APPLE");
    const button = screen.getByRole("button", { name: "Restore this version" }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Online is finished for this shift")).toBeTruthy();
  });

  it("offers no restore on the Manual Count sheet", async () => {
    api.getSheetPublishes.mockResolvedValue({ publishes: [] });
    open("manual");
    await screen.findAllByRole("button", { name: /Ana/ });
    expect(screen.queryByRole("button", { name: "Restore this version" })).toBeNull();
  });
});
