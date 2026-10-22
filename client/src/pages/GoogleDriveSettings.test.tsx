import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DriveStatus } from "../api/drive";
import { GoogleDriveSettings } from "./GoogleDriveSettings";

const api = vi.hoisted(() => ({
  getDriveStatus: vi.fn(),
  startDriveConnect: vi.fn(),
  disconnectDrive: vi.fn(),
  updateDriveSettings: vi.fn(),
  backupToDriveNow: vi.fn(),
}));
vi.mock("../api/drive", () => api);
const nav = vi.hoisted(() => ({ goTo: vi.fn() }));
vi.mock("../utils/navigate", () => nav);

const REDIRECT = "http://localhost:8080/api/drive/oauth/callback";
const base: DriveStatus = {
  configured: true,
  redirectUri: REDIRECT,
  connected: false,
  accountEmail: null,
  connectedAt: null,
  lastBackupAt: null,
  lastReportAt: null,
  nextBackupAt: null,
  lastError: null,
  settings: null,
  recent: [],
};
const connected = (over: Partial<DriveStatus> = {}): DriveStatus => ({
  ...base,
  connected: true,
  accountEmail: "owner@gmail.com",
  settings: { autoBackup: true, backupHourUtc: 18, keepBackups: 14, saveExports: true },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/settings");
  // Manila: UTC+8, so the stored 18:00 UTC reads as 2:00 AM.
  vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-480);
});
afterEach(() => vi.restoreAllMocks());

async function show(status: DriveStatus) {
  api.getDriveStatus.mockResolvedValue(status);
  render(<GoogleDriveSettings />);
  await screen.findByText("Google Drive");
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
}

describe("before it is connected", () => {
  it("says the server needs setting up, and shows the redirect address to register with Google", async () => {
    await show({ ...base, configured: false });
    expect(screen.getByText(/not set up on this server yet/i)).toBeInTheDocument();
    expect(screen.getByText(REDIRECT)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Connect Google Drive/ })).toBeNull();
  });

  it("offers Connect, and sends the browser to Google's consent address", async () => {
    api.startDriveConnect.mockResolvedValue({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=abc" });
    await show(base);
    fireEvent.click(screen.getByRole("button", { name: /Connect Google Drive/ }));
    await waitFor(() => expect(nav.goTo).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?state=abc"));
  });

  it("warns, rather than letting it fail at Google, when opened from a LAN address", async () => {
    const real = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...real, protocol: "http:", hostname: "192.168.1.155", search: "", pathname: "/settings" } });
    try {
      await show(base);
      expect(screen.getByRole("alert")).toHaveTextContent(/http:\/\/localhost/);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: real });
    }
  });

  it("does not warn on localhost", async () => {
    await show(base);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the reason when Connect itself fails", async () => {
    api.startDriveConnect.mockRejectedValue(new Error("Google Drive is not set up on this server"));
    await show(base);
    fireEvent.click(screen.getByRole("button", { name: /Connect Google Drive/ }));
    expect(await screen.findByText(/not set up on this server/)).toBeInTheDocument();
    expect(nav.goTo).not.toHaveBeenCalled();
  });
});

describe("coming back from Google", () => {
  it("tells the admin it worked, then clears the address bar so a refresh does not repeat it", async () => {
    window.history.replaceState(null, "", "/settings?drive=connected");
    await show(connected());
    expect(await screen.findByText("Google Drive is connected.")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("shows Google's refusal and the server's reason for a failed connect", async () => {
    window.history.replaceState(null, "", "/settings?drive=denied");
    await show(base);
    expect(await screen.findByText(/access was declined/)).toBeInTheDocument();

    window.history.replaceState(null, "", "/settings?drive=error&reason=This%20connect%20link%20has%20expired");
    render(<GoogleDriveSettings />);
    expect(await screen.findByText("This connect link has expired")).toBeInTheDocument();
  });
});

describe("once connected", () => {
  it("shows the account and its settings", async () => {
    await show(connected());
    expect(screen.getByText("owner@gmail.com")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /end of every month/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /copy of every Excel/ })).toBeChecked();
    expect(screen.getByLabelText("Number of backups to keep")).toHaveValue(14);
  });

  it("shows the backup time on the person's own clock, not in UTC", async () => {
    await show(connected());
    expect(screen.getByLabelText("Time of the daily backup")).toHaveDisplayValue("2:00 AM");
  });

  it("saves a new backup time as the UTC hour the server stores", async () => {
    api.updateDriveSettings.mockResolvedValue(connected());
    await show(connected());
    fireEvent.change(screen.getByLabelText("Time of the daily backup"), { target: { value: "3" } });
    await waitFor(() => expect(api.updateDriveSettings).toHaveBeenCalledWith({ backupHourUtc: 19 }));
  });

  it("falls back to plain UTC hours in a half-hour time zone instead of guessing", async () => {
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-330);
    await show(connected());
    expect(screen.getByLabelText("Time of the daily backup")).toHaveDisplayValue("18:00 UTC");
  });

  it("hides the time picker while the daily backup is off", async () => {
    await show(connected({ settings: { autoBackup: false, backupHourUtc: 18, keepBackups: 14, saveExports: true } }));
    expect(screen.queryByLabelText("Time of the daily backup")).toBeNull();
  });

  it("applies each switch the moment it is changed", async () => {
    api.updateDriveSettings.mockResolvedValue(connected());
    await show(connected());
    fireEvent.click(screen.getByRole("checkbox", { name: /end of every month/ }));
    await waitFor(() => expect(api.updateDriveSettings).toHaveBeenLastCalledWith({ autoBackup: false }));
    fireEvent.click(screen.getByRole("checkbox", { name: /copy of every Excel/ }));
    await waitFor(() => expect(api.updateDriveSettings).toHaveBeenLastCalledWith({ saveExports: false }));
  });

  it("commits a valid number of backups to keep when leaving the field", async () => {
    api.updateDriveSettings.mockResolvedValue(connected());
    await show(connected());
    const input = screen.getByLabelText("Number of backups to keep");
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.blur(input);
    await waitFor(() => expect(api.updateDriveSettings).toHaveBeenCalledWith({ keepBackups: 30 }));
  });

  it.each(["0", "400", "2.5", ""])("refuses %j as a number of backups to keep, and puts the old value back", async (bad) => {
    await show(connected());
    const input = screen.getByLabelText("Number of backups to keep");
    fireEvent.change(input, { target: { value: bad } });
    fireEvent.blur(input);
    expect(await screen.findByText("Keep between 1 and 365 backups.")).toBeInTheDocument();
    expect(input).toHaveValue(14);
    expect(api.updateDriveSettings).not.toHaveBeenCalled();
  });

  it("backs up on demand and reports the file", async () => {
    api.backupToDriveNow.mockResolvedValue({ fileName: "ala-eh-backup-2026-10-22-1830.sql.gz", sizeBytes: 2_621_440, status: connected({ lastBackupAt: "2026-10-22T10:30:00Z" }) });
    await show(connected());
    fireEvent.click(screen.getByRole("button", { name: /Back up to Drive now/ }));
    expect(await screen.findByText(/ala-eh-backup-2026-10-22-1830\.sql\.gz \(2\.5 MB\)/)).toBeInTheDocument();
  });

  it("shows why a backup failed", async () => {
    api.backupToDriveNow.mockRejectedValue(new Error("Uploading to Drive failed (403): Quota exceeded"));
    await show(connected());
    fireEvent.click(screen.getByRole("button", { name: /Back up to Drive now/ }));
    expect(await screen.findByText(/Quota exceeded/)).toBeInTheDocument();
  });

  it("asks before disconnecting, and does nothing if the admin cancels", async () => {
    await show(connected());
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(api.disconnectDrive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(api.disconnectDrive).not.toHaveBeenCalled();
  });

  it("disconnects once confirmed, and goes back to the connect screen", async () => {
    api.disconnectDrive.mockResolvedValue(base);
    await show(connected());
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: /Yes, disconnect/ }));
    expect(await screen.findByRole("button", { name: /Connect Google Drive/ })).toBeInTheDocument();
  });

  it("shows a revoked-access problem prominently, with a way to reconnect", async () => {
    api.startDriveConnect.mockResolvedValue({ url: "https://accounts.google.com/x" });
    await show(connected({ lastError: "Google no longer accepts this connection - reconnect Google Drive." }));
    expect(screen.getByRole("alert")).toHaveTextContent(/reconnect Google Drive/);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(nav.goTo).toHaveBeenCalledWith("https://accounts.google.com/x"));
  });

  it("lists recent uploads with their result", async () => {
    await show(
      connected({
        recent: [
          { id: 2, kind: "export", fileName: "daily-out.csv", sizeBytes: 2048, status: "FAILED", error: "Quota exceeded", createdAt: "2026-10-22T10:00:00Z" },
          { id: 1, kind: "backup", fileName: "ala-eh-backup.sql.gz", sizeBytes: 3_145_728, status: "OK", error: null, createdAt: "2026-10-22T02:00:00Z" },
        ],
      }),
    );
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("Failed")).toBeInTheDocument();
    expect(within(rows[1]).getByText("2.0 KB")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Saved")).toBeInTheDocument();
    expect(within(rows[2]).getByText("3.0 MB")).toBeInTheDocument();
  });

  it("says the backup is monthly, at the end of the month, and when the next one is due", async () => {
    await show(connected({ nextBackupAt: "2026-10-31T18:00:00Z" }));
    const card = screen.getByRole("region", { name: "Database backup" });
    expect(within(card).getByRole("checkbox", { name: /end of every month/ })).toBeChecked();
    expect(within(card).getByText(/on the last day, at/)).toBeInTheDocument();
    expect(within(card).getByText(/Next backup/)).toBeInTheDocument();
  });

  it("shows no next-backup time while the monthly backup is off", async () => {
    await show(connected({ nextBackupAt: null, settings: { autoBackup: false, backupHourUtc: 18, keepBackups: 14, saveExports: true } }));
    expect(screen.queryByText(/Next backup/)).toBeNull();
  });

  it("says the daily reports are saved automatically, and where", async () => {
    await show(connected({ lastReportAt: "2026-10-22T10:30:00Z" }));
    const card = screen.getByRole("region", { name: "Daily reports" });
    expect(within(card).getByText("Automatic")).toBeInTheDocument();
    expect(within(card).getByText("Ala Eh Stocks Monitoring - Reports / year / month")).toBeInTheDocument();
    expect(within(card).getByText(/Last saved/)).toBeInTheDocument();
    // Nothing to switch: it is simply on.
    expect(within(card).queryByRole("checkbox")).toBeNull();
  });

  it("says no report has been saved yet before the first one", async () => {
    await show(connected());
    expect(within(screen.getByRole("region", { name: "Daily reports" })).getByText(/No report has been saved yet/)).toBeInTheDocument();
  });

  it("marks the backup and export cards Off when their switches are off", async () => {
    await show(connected({ settings: { autoBackup: false, backupHourUtc: 18, keepBackups: 14, saveExports: false } }));
    expect(within(screen.getByRole("region", { name: "Database backup" })).getByText("Off")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Export copies" })).getByText("Off")).toBeInTheDocument();
  });

  it("labels each upload's type and filters the activity by it", async () => {
    await show(
      connected({
        recent: [
          { id: 3, kind: "report", fileName: "daily-report-2026-10-22.xlsx", sizeBytes: 9000, status: "OK", error: null, createdAt: "2026-10-22T10:30:00Z" },
          { id: 2, kind: "export", fileName: "daily-out.csv", sizeBytes: 2048, status: "OK", error: null, createdAt: "2026-10-22T10:00:00Z" },
          { id: 1, kind: "backup", fileName: "ala-eh-backup.sql.gz", sizeBytes: 3_145_728, status: "OK", error: null, createdAt: "2026-10-22T02:00:00Z" },
        ],
      }),
    );
    expect(screen.getAllByRole("row")).toHaveLength(4); // header + 3
    fireEvent.click(screen.getByRole("button", { name: "Reports" }));
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText("Report")).toBeInTheDocument();
    expect(within(rows[1]).getByText("daily-report-2026-10-22.xlsx")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Backups" }));
    expect(screen.getByText("ala-eh-backup.sql.gz")).toBeInTheDocument();
    expect(screen.queryByText("daily-out.csv")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  it("says so when a filter has nothing, and counts failed uploads up top with the reason in the row", async () => {
    await show(
      connected({
        recent: [{ id: 1, kind: "report", fileName: "daily-report-2026-10-22.xlsx", sizeBytes: 9000, status: "FAILED", error: "Drive is full", createdAt: "2026-10-22T10:30:00Z" }],
      }),
    );
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.getAllByText("Drive is full").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Backups" }));
    expect(screen.getByText("Nothing of this kind in the recent activity.")).toBeInTheDocument();
  });
});
