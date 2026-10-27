import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../config/env", () => ({
  env: { googleRedirectUri: "http://localhost:8080/api/drive/oauth/callback" },
}));
vi.mock("../services/drive.service", () => ({
  completeConnect: vi.fn(),
  disconnect: vi.fn(),
  exportConfig: vi.fn(),
  getStatus: vi.fn().mockResolvedValue({ connected: true }),
  runBackup: vi.fn(),
  saveExport: vi.fn(),
  saveGeneratedReport: vi.fn(),
  startConnect: vi.fn(),
  updateSettings: vi.fn(),
}));

import { DriveApiError, DriveAuthError } from "../lib/googleDrive";
import * as drive from "../services/drive.service";
import { HttpError } from "../utils/HttpError";
import {
  getDriveCallback,
  patchDriveSettings,
  postDriveBackupNow,
  postDriveConnect,
  postDriveExportCopy,
  postDriveGeneratedReport,
} from "./drive.controller";

const user = { id: 7, role: "SUPERVISOR_ADMIN" };
function call<T>(handler: (req: Request, res: Response) => T, req: Record<string, unknown>) {
  const res = { json: vi.fn(), redirect: vi.fn() };
  const request = { user, query: {}, body: {}, header: () => undefined, ...req } as unknown as Request;
  return { res, done: Promise.resolve(handler(request, res as unknown as Response)) };
}

beforeEach(() => vi.clearAllMocks());

describe("postDriveConnect", () => {
  it("hands back the Google consent address for the signed-in admin", async () => {
    vi.mocked(drive.startConnect).mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?x=1");
    const { res, done } = call(postDriveConnect, {});
    await done;
    expect(drive.startConnect).toHaveBeenCalledWith(7);
    expect(res.json).toHaveBeenCalledWith({ url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" });
  });
});

describe("getDriveCallback", () => {
  const redirectedTo = (res: { redirect: ReturnType<typeof vi.fn> }) => new URL(res.redirect.mock.calls[0][0]);

  it("sends the browser back to Settings on the origin Google returned it to, saying it worked", async () => {
    const { res, done } = call(getDriveCallback, { query: { code: "c", state: "s" } });
    await done;
    expect(drive.completeConnect).toHaveBeenCalledWith("c", "s");
    const url = redirectedTo(res);
    expect(url.origin).toBe("http://localhost:8080");
    expect(url.pathname).toBe("/settings");
    expect(url.searchParams.get("drive")).toBe("connected");
  });

  it("reports a refusal at Google's consent screen without trying to connect", async () => {
    const { res, done } = call(getDriveCallback, { query: { error: "access_denied" } });
    await done;
    expect(drive.completeConnect).not.toHaveBeenCalled();
    expect(redirectedTo(res).searchParams.get("drive")).toBe("denied");
  });

  it("reports missing details, and never connects without a state", async () => {
    const { res, done } = call(getDriveCallback, { query: { code: "c" } });
    await done;
    expect(drive.completeConnect).not.toHaveBeenCalled();
    expect(redirectedTo(res).searchParams.get("drive")).toBe("error");
  });

  it("turns a failed connect (bad state, no refresh token) into a readable message on Settings", async () => {
    vi.mocked(drive.completeConnect).mockRejectedValue(HttpError.badRequest("This connect link has expired or is not valid."));
    const { res, done } = call(getDriveCallback, { query: { code: "c", state: "forged" } });
    await done;
    const url = redirectedTo(res);
    expect(url.searchParams.get("drive")).toBe("error");
    expect(url.searchParams.get("reason")).toMatch(/expired or is not valid/);
  });

  it("never puts an internal error (database, library) into the address", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(drive.completeConnect).mockRejectedValue(new Error("connect ECONNREFUSED 172.28.0.2:3306 user alaeh_app"));
    const { res, done } = call(getDriveCallback, { query: { code: "c", state: "s" } });
    await done;
    const url = redirectedTo(res);
    expect(url.searchParams.get("drive")).toBe("error");
    expect(url.toString()).not.toMatch(/ECONNREFUSED|alaeh_app|172\.28/);
    expect(log).toHaveBeenCalled(); // the real cause still reaches the server log
    log.mockRestore();
  });

  it("bounds the message it puts in the address", async () => {
    vi.mocked(drive.completeConnect).mockRejectedValue(HttpError.badRequest("x".repeat(5000)));
    const { res, done } = call(getDriveCallback, { query: { code: "c", state: "s" } });
    await done;
    expect(redirectedTo(res).searchParams.get("reason")!.length).toBeLessThanOrEqual(200);
  });
});

describe("patchDriveSettings", () => {
  it("applies valid changes", async () => {
    const { res, done } = call(patchDriveSettings, { body: { autoBackup: false, backupHourUtc: 3, keepBackups: 30, saveExports: false } });
    await done;
    expect(drive.updateSettings).toHaveBeenCalledWith({ autoBackup: false, backupHourUtc: 3, keepBackups: 30, saveExports: false }, 7);
    expect(res.json).toHaveBeenCalled();
  });

  it.each([
    ["an hour past 23", { backupHourUtc: 24 }],
    ["a negative hour", { backupHourUtc: -1 }],
    ["a weekday past 6", { backupWeekday: 7 }],
    ["a negative weekday", { backupWeekday: -1 }],
    ["a fractional weekday", { backupWeekday: 2.5 }],
    ["a fractional hour", { backupHourUtc: 2.5 }],
    ["keeping zero backups", { keepBackups: 0 }],
    ["keeping more than a year of daily copies", { keepBackups: 366 }],
    ["a string where a switch belongs", { autoBackup: "yes" }],
    ["a field that does not exist", { refreshTokenEnc: "x" }],
    ["nothing at all", {}],
  ])("rejects %s", async (_label, body) => {
    const { done } = call(patchDriveSettings, { body });
    await expect(done).rejects.toThrow(/Invalid Google Drive settings/);
    expect(drive.updateSettings).not.toHaveBeenCalled();
  });
});

describe("postDriveBackupNow", () => {
  it("runs a manual backup as the signed-in admin", async () => {
    vi.mocked(drive.runBackup).mockResolvedValue({ fileName: "b.sql.gz", sizeBytes: 5 });
    const { res, done } = call(postDriveBackupNow, {});
    await done;
    expect(drive.runBackup).toHaveBeenCalledWith("manual", 7);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ fileName: "b.sql.gz" }));
  });

  it("tells the admin to reconnect when Google has revoked access", async () => {
    vi.mocked(drive.runBackup).mockRejectedValue(new DriveAuthError("Google no longer accepts this connection - reconnect Google Drive."));
    const { done } = call(postDriveBackupNow, {});
    await expect(done).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/reconnect/i) });
  });

  it("reports a Google-side failure as a 502 with its reason", async () => {
    vi.mocked(drive.runBackup).mockRejectedValue(new DriveApiError("Uploading to Drive failed (403): Quota exceeded", 403));
    const { done } = call(postDriveBackupNow, {});
    await expect(done).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/Quota exceeded/) });
  });
});

describe("postDriveExportCopy", () => {
  const withHeader = (name: string | undefined) => ({ header: (h: string) => (h.toLowerCase() === "x-filename" ? name : undefined) });

  it("saves the body under the (URL-decoded) name from the header", async () => {
    vi.mocked(drive.saveExport).mockResolvedValue({ saved: true });
    const body = Buffer.from("a,b\n1,2\n");
    const { res, done } = call(postDriveExportCopy, { ...withHeader(encodeURIComponent("Stock Report – Oct.csv")), body });
    await done;
    expect(drive.saveExport).toHaveBeenCalledWith("Stock Report – Oct.csv", body, 7);
    expect(res.json).toHaveBeenCalledWith({ saved: true });
  });

  it("rejects a request with no file name, an empty body, or a body that was not read as bytes", async () => {
    await expect(call(postDriveExportCopy, { ...withHeader(undefined), body: Buffer.from("x") }).done).rejects.toThrow(/X-Filename/);
    await expect(call(postDriveExportCopy, { ...withHeader("a.csv"), body: Buffer.alloc(0) }).done).rejects.toThrow(/empty/);
    await expect(call(postDriveExportCopy, { ...withHeader("a.csv"), body: { not: "bytes" } }).done).rejects.toThrow(/empty/);
    expect(drive.saveExport).not.toHaveBeenCalled();
  });

  it("rejects a file name that is not valid percent-encoding", async () => {
    await expect(call(postDriveExportCopy, { ...withHeader("%E0%A4%A"), body: Buffer.from("x") }).done).rejects.toThrow(/not valid/);
  });
});

describe("postDriveGeneratedReport", () => {
  it("saves the report of the date asked for, as the signed-in person, and answers with what came of it", async () => {
    vi.mocked(drive.saveGeneratedReport).mockResolvedValue("unchanged");
    const { res, done } = call(postDriveGeneratedReport, { body: { date: "2026-10-22" } });
    await done;
    expect(drive.saveGeneratedReport).toHaveBeenCalledWith(new Date("2026-10-22T00:00:00.000Z"), 7);
    expect(res.json).toHaveBeenCalledWith({ status: "unchanged" });
  });

  it.each([
    ["no date", {}],
    ["a date that is not a date", { date: "tomorrow" }],
    ["an impossible date", { date: "2026-02-31" }],
    ["a number", { date: 20261022 }],
  ])("refuses %s before touching Drive", async (_label, body) => {
    const { done } = call(postDriveGeneratedReport, { body });
    await expect(done).rejects.toMatchObject({ status: 400 });
    expect(drive.saveGeneratedReport).not.toHaveBeenCalled();
  });

  it("turns Google's own failures into readable errors, not a bare 500", async () => {
    vi.mocked(drive.saveGeneratedReport).mockRejectedValue(new DriveAuthError("reconnect Google Drive"));
    await expect(call(postDriveGeneratedReport, { body: { date: "2026-10-22" } }).done).rejects.toMatchObject({ status: 400 });
    vi.mocked(drive.saveGeneratedReport).mockRejectedValue(new DriveApiError("Uploading to Drive failed (403)", 403));
    await expect(call(postDriveGeneratedReport, { body: { date: "2026-10-22" } }).done).rejects.toMatchObject({ status: 502 });
  });
});
