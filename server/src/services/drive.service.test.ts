import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "fs";
import jwt from "jsonwebtoken";

const JWT_SECRET = "jwt-secret-for-tests-0123456789abcdef0123456789";
vi.mock("../config/env", () => ({
  env: {
    googleClientId: "cid.apps.googleusercontent.com",
    googleClientSecret: "client-secret",
    googleRedirectUri: "http://localhost:8080/api/drive/oauth/callback",
    driveTokenKey: "",
    jwtSecret: "jwt-secret-for-tests-0123456789abcdef0123456789",
  },
}));

const db = vi.hoisted(() => ({ conn: null as Record<string, unknown> | null, uploads: [] as Record<string, unknown>[] }));
vi.mock("../lib/prisma", () => ({
  prisma: {
    driveConnection: {
      findUnique: vi.fn(async () => db.conn),
      upsert: vi.fn(async ({ create, update }: { create: object; update: object }) => (db.conn = { ...(db.conn ?? {}), ...(db.conn ? update : create) })),
      update: vi.fn(async ({ data }: { data: object }) => (db.conn = { ...db.conn, ...data })),
      delete: vi.fn(async () => (db.conn = null)),
    },
    driveUpload: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => void db.uploads.push(data)),
      findMany: vi.fn(async () => []),
    },
  },
}));
vi.mock("../lib/googleDrive", async (orig) => ({
  ...(await orig<typeof import("../lib/googleDrive")>()),
  exchangeCode: vi.fn(),
  refreshAccessToken: vi.fn(),
  fetchAccountEmail: vi.fn(),
  createFolder: vi.fn(),
  uploadFile: vi.fn(),
  listFolder: vi.fn(),
  trashFile: vi.fn(),
  revokeToken: vi.fn(),
}));
vi.mock("./backup.service", () => ({ dumpDatabaseToGzipFile: vi.fn() }));
vi.mock("./backupVerify.service", () => ({ recordBackup: vi.fn() }));
vi.mock("./changeLog.service", () => ({ logSystemEvent: vi.fn() }));

import * as google from "../lib/googleDrive";
import { dumpDatabaseToGzipFile } from "./backup.service";
import { recordBackup } from "./backupVerify.service";
import { open } from "../utils/secretBox";
import {
  completeConnect,
  disconnect,
  exportFileInfo,
  isBackupDue,
  resetScheduleState,
  runBackup,
  runScheduledBackupIfDue,
  saveExport,
  startConnect,
} from "./drive.service";

const stateKey = `${JWT_SECRET}:drive-state`;
const stateFor = (payload: object, secret = stateKey, opts: jwt.SignOptions = { expiresIn: "10m" }) =>
  jwt.sign(payload, secret, { algorithm: "HS256", ...opts });

/// vi.clearAllMocks keeps queued one-shot results, so one test's leftover
/// "reject once" would fire in the next. These are re-armed below.
const resettable = [
  google.refreshAccessToken, google.uploadFile, google.listFolder, google.trashFile, google.createFolder,
  google.exchangeCode, google.fetchAccountEmail, google.revokeToken, dumpDatabaseToGzipFile, recordBackup,
];

beforeEach(async () => {
  vi.clearAllMocks();
  resettable.forEach((m) => vi.mocked(m).mockReset());
  db.conn = null;
  db.uploads = [];
  resetScheduleState();
  vi.mocked(google.refreshAccessToken).mockResolvedValue({ accessToken: "access-1", expiresIn: 3600 });
  vi.mocked(google.uploadFile).mockImplementation(async (_t, input) => {
    (input.body as { destroy?: () => void }).destroy?.();
    return "drive-file-1";
  });
  vi.mocked(google.listFolder).mockResolvedValue([]);
  vi.mocked(dumpDatabaseToGzipFile).mockImplementation(async (path) => {
    writeFileSync(path, "gzipped-bytes");
    return { sizeBytes: 13, sha256: "abc123", complete: true };
  });
  // A real sealed token, made by a real connect.
  vi.mocked(google.exchangeCode).mockResolvedValue({ accessToken: "a", refreshToken: "1//the-refresh-token", expiresIn: 3600 });
  vi.mocked(google.fetchAccountEmail).mockResolvedValue("owner@gmail.com");
  vi.mocked(google.createFolder).mockResolvedValueOnce("backups-folder").mockResolvedValueOnce("exports-folder");
  await completeConnect("code", stateFor({ purpose: "drive-connect", uid: 7 }));
  vi.mocked(google.createFolder).mockReset();
  // The columns the real database fills in from the schema defaults.
  Object.assign(db.conn!, { autoBackup: true, backupHourUtc: 18, keepBackups: 3, saveExports: true, lastBackupAt: null });
});

describe("connecting", () => {
  it("starts with a signed, expiring state in the link", () => {
    const url = new URL(startConnect(7));
    const decoded = jwt.verify(url.searchParams.get("state")!, stateKey) as { purpose: string; uid: number; exp: number };
    expect(decoded).toMatchObject({ purpose: "drive-connect", uid: 7 });
    expect(decoded.exp).toBeGreaterThan(Date.now() / 1000);
  });

  it("stores the refresh token encrypted - never in the clear", () => {
    const stored = String(db.conn!.refreshTokenEnc);
    expect(stored).not.toContain("1//the-refresh-token");
    expect(open(stored, JWT_SECRET)).toBe("1//the-refresh-token");
  });

  it("creates the two folders and remembers who connected which account", () => {
    expect(db.conn).toMatchObject({ accountEmail: "owner@gmail.com", backupFolderId: "backups-folder", exportFolderId: "exports-folder", connectedById: 7 });
  });

  it("refuses a forged, expired or wrong-purpose state", async () => {
    for (const bad of [
      "not-a-jwt",
      stateFor({ purpose: "drive-connect", uid: 7 }, "some-other-secret"),
      stateFor({ purpose: "drive-connect", uid: 7 }, stateKey, { expiresIn: -10 }),
      stateFor({ purpose: "login", uid: 7 }),
      stateFor({ uid: 7 }),
    ]) {
      await expect(completeConnect("code", bad)).rejects.toThrow(/expired or is not valid/);
    }
  });

  it("does not accept a login token as a connect state", async () => {
    const loginToken = jwt.sign({ id: 7, role: "SUPERVISOR_ADMIN" }, JWT_SECRET, { algorithm: "HS256" });
    await expect(completeConnect("code", loginToken)).rejects.toThrow(/not valid/);
  });

  it("explains how to recover when Google withholds the refresh token", async () => {
    vi.mocked(google.exchangeCode).mockResolvedValue({ accessToken: "a", expiresIn: 3600 });
    await expect(completeConnect("code", stateFor({ purpose: "drive-connect", uid: 7 }))).rejects.toThrow(/myaccount\.google\.com\/permissions/);
  });

  it("keeps the folders and settings when the same account reconnects, but starts fresh for a different one", async () => {
    Object.assign(db.conn!, { keepBackups: 30 });
    await completeConnect("code", stateFor({ purpose: "drive-connect", uid: 7 }));
    expect(google.createFolder).not.toHaveBeenCalled();
    expect(db.conn).toMatchObject({ backupFolderId: "backups-folder", keepBackups: 30 });

    vi.mocked(google.fetchAccountEmail).mockResolvedValue("someone-else@gmail.com");
    vi.mocked(google.createFolder).mockResolvedValueOnce("new-backups").mockResolvedValueOnce("new-exports");
    await completeConnect("code", stateFor({ purpose: "drive-connect", uid: 7 }));
    expect(db.conn).toMatchObject({ accountEmail: "someone-else@gmail.com", backupFolderId: "new-backups", exportFolderId: "new-exports" });
  });

  it("revokes the token at Google and forgets the connection when disconnected", async () => {
    await disconnect(7);
    expect(google.revokeToken).toHaveBeenCalledWith("1//the-refresh-token");
    expect(db.conn).toBeNull();
  });
});

describe("exportFileInfo", () => {
  it("accepts the app's own export types and gives each its content type", () => {
    expect(exportFileInfo("total-stocks-2026-10-22.csv")).toEqual({ name: "total-stocks-2026-10-22.csv", mimeType: "text/csv" });
    expect(exportFileInfo("report.xlsx")?.mimeType).toContain("spreadsheetml");
    expect(exportFileInfo("report.xls")?.mimeType).toBe("application/vnd.ms-excel");
    expect(exportFileInfo("daily.pdf")?.mimeType).toBe("application/pdf");
    expect(exportFileInfo("pack.zip")?.mimeType).toBe("application/zip");
  });

  it("rejects anything else, whatever it is called", () => {
    for (const bad of ["setup.exe", "page.html", "notes.txt", "noextension", "", ".csv.exe", "script.js"]) {
      expect(exportFileInfo(bad)).toBeNull();
    }
  });

  it("strips path parts and control characters from the name the browser supplied", () => {
    expect(exportFileInfo("../../etc/passwd.csv")?.name).toBe("passwd.csv");
    expect(exportFileInfo("C:\\Users\\x\\sheet.csv")?.name).toBe("sheet.csv");
    expect(exportFileInfo("a\u0000b\nc.csv")?.name).toBe("abc.csv");
  });

  it("bounds the length", () => {
    expect(exportFileInfo(`${"x".repeat(500)}.csv`)!.name.length).toBeLessThanOrEqual(150);
  });
});

describe("saveExport", () => {
  it("uploads to the exports folder and logs it", async () => {
    expect(await saveExport("daily.pdf", Buffer.from("%PDF"), 3)).toEqual({ saved: true });
    expect(google.uploadFile).toHaveBeenCalledWith(
      "access-1",
      expect.objectContaining({ name: "daily.pdf", parentId: "exports-folder", mimeType: "application/pdf", size: 4 }),
    );
    expect(db.uploads.at(-1)).toMatchObject({ kind: "export", fileName: "daily.pdf", status: "OK", createdById: 3 });
  });

  it("does nothing when Drive is not connected, or exports are switched off", async () => {
    Object.assign(db.conn!, { saveExports: false });
    expect(await saveExport("a.csv", Buffer.from("x"), 3)).toEqual({ saved: false });
    db.conn = null;
    expect(await saveExport("a.csv", Buffer.from("x"), 3)).toEqual({ saved: false });
    expect(google.uploadFile).not.toHaveBeenCalled();
  });

  it("refuses a file type that is not an export, before touching Google", async () => {
    await expect(saveExport("virus.exe", Buffer.from("x"), 3)).rejects.toThrow(/Only CSV, Excel, PDF and ZIP/);
    expect(google.uploadFile).not.toHaveBeenCalled();
  });

  it("records a failed upload and rethrows it", async () => {
    vi.mocked(google.uploadFile).mockRejectedValueOnce(new Error("Quota exceeded"));
    await expect(saveExport("a.csv", Buffer.from("x"), 3)).rejects.toThrow("Quota exceeded");
    expect(db.uploads.at(-1)).toMatchObject({ kind: "export", status: "FAILED", error: "Quota exceeded" });
  });

  it("tells the admin to reconnect when Google has revoked access", async () => {
    vi.mocked(google.refreshAccessToken).mockRejectedValueOnce(new google.DriveAuthError("Google no longer accepts this connection - reconnect Google Drive."));
    // The access token from the connect step may be cached; force a refresh by clearing it via a failed disconnect-free path.
    await disconnectAndReconnect();
    await expect(saveExport("a.csv", Buffer.from("x"), 3)).rejects.toBeInstanceOf(google.DriveAuthError);
    expect(db.conn!.lastError).toMatch(/reconnect/i);
  });
});

/// Resets the module's cached access token (a reconnect clears it), then makes
/// the next refresh fail like a revoked grant.
async function disconnectAndReconnect() {
  vi.mocked(google.createFolder).mockResolvedValueOnce("backups-folder").mockResolvedValueOnce("exports-folder");
  await disconnect(7);
  await completeConnect("code", stateFor({ purpose: "drive-connect", uid: 7 }));
  Object.assign(db.conn!, { autoBackup: true, backupHourUtc: 18, keepBackups: 3, saveExports: true, lastBackupAt: null });
  vi.mocked(google.createFolder).mockReset();
  vi.mocked(google.refreshAccessToken).mockRejectedValueOnce(new google.DriveAuthError("Google no longer accepts this connection - reconnect Google Drive."));
}

describe("runBackup", () => {
  it("uploads a gzipped dump, records it as a good backup and notes the time", async () => {
    const result = await runBackup("manual", 9);
    expect(result.fileName).toMatch(/^ala-eh-backup-\d{4}-\d{2}-\d{2}-\d{4}\.sql\.gz$/);
    expect(google.uploadFile).toHaveBeenCalledWith("access-1", expect.objectContaining({ parentId: "backups-folder", mimeType: "application/gzip" }));
    expect(recordBackup).toHaveBeenCalledWith(expect.objectContaining({ trigger: "manual", status: "OK", sha256: "abc123", createdById: 9 }));
    expect(db.conn!.lastBackupAt).toBeInstanceOf(Date);
    expect(db.conn!.lastError).toBeNull();
  });

  it("keeps only the newest N backups, trashing the rest", async () => {
    vi.mocked(google.listFolder).mockResolvedValue(["f5", "f4", "f3", "f2", "f1"].map((id) => ({ id, name: id, createdTime: "" })));
    await runBackup("manual");
    expect(vi.mocked(google.trashFile).mock.calls.map((c) => c[1])).toEqual(["f2", "f1"]);
  });

  it("does not fail a good backup because tidying the old ones failed", async () => {
    vi.mocked(google.listFolder).mockRejectedValue(new Error("Drive hiccup"));
    await expect(runBackup("manual")).resolves.toBeTruthy();
  });

  it("does not upload a dump that is missing its closing line, and reports it as failed", async () => {
    vi.mocked(dumpDatabaseToGzipFile).mockImplementation(async (path) => {
      writeFileSync(path, "x");
      return { sizeBytes: 1, sha256: "x", complete: false };
    });
    await expect(runBackup("scheduled")).rejects.toThrow(/Dump completed/);
    expect(google.uploadFile).not.toHaveBeenCalled();
    expect(recordBackup).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED", trigger: "scheduled" }));
    expect(db.uploads.at(-1)).toMatchObject({ kind: "backup", status: "FAILED" });
    expect(db.conn!.lastError).toMatch(/Dump completed/);
  });

  it("refuses to start a second backup while one is running", async () => {
    let release!: () => void;
    vi.mocked(google.uploadFile).mockImplementationOnce(
      (_t, input) =>
        new Promise((resolve) => {
          release = () => {
            (input.body as { destroy?: () => void }).destroy?.();
            resolve("drive-file-1");
          };
        }),
    );
    const first = runBackup("manual");
    await vi.waitFor(() => expect(google.uploadFile).toHaveBeenCalled());
    await expect(runBackup("manual")).rejects.toThrow(/already running/);
    release();
    await first;
    await expect(runBackup("manual")).resolves.toBeTruthy();
  });

  it("refuses when Drive is not connected", async () => {
    db.conn = null;
    await expect(runBackup("manual")).rejects.toThrow(/not connected/);
  });
});

describe("isBackupDue", () => {
  const at = (iso: string) => new Date(iso);
  const conn = (lastBackupAt: string | null, backupHourUtc = 18, autoBackup = true) => ({
    autoBackup,
    backupHourUtc,
    lastBackupAt: lastBackupAt ? at(lastBackupAt) : null,
  });

  it("is due once the scheduled time has passed with no backup since", () => {
    expect(isBackupDue(conn("2026-10-21T18:05:00Z"), at("2026-10-22T18:00:00Z"))).toBe(true);
    expect(isBackupDue(conn(null), at("2026-10-22T03:00:00Z"))).toBe(true);
  });

  it("is not due before the time, or after a backup that already covered this slot", () => {
    expect(isBackupDue(conn("2026-10-21T18:05:00Z"), at("2026-10-22T17:59:00Z"))).toBe(false);
    expect(isBackupDue(conn("2026-10-22T18:05:00Z"), at("2026-10-22T23:00:00Z"))).toBe(false);
  });

  it("does not fire a second time the same day after the hour is changed", () => {
    // Backed up at 02:10; at 22:10 that is 20h ago, but today's 02:00 slot is already covered.
    expect(isBackupDue(conn("2026-10-22T02:10:00Z", 2), at("2026-10-22T22:10:00Z"))).toBe(false);
    expect(isBackupDue(conn("2026-10-22T02:10:00Z", 2), at("2026-10-23T02:00:00Z"))).toBe(true);
  });

  it("catches up after downtime: a missed slot is due as soon as the server is back", () => {
    expect(isBackupDue(conn("2026-10-19T18:05:00Z"), at("2026-10-22T09:00:00Z"))).toBe(true);
  });

  it("is never due when automatic backups are off", () => {
    expect(isBackupDue(conn(null, 18, false), at("2026-10-22T20:00:00Z"))).toBe(false);
  });
});

describe("runScheduledBackupIfDue", () => {
  it("runs a backup that is due, and does nothing when it is not", async () => {
    expect(await runScheduledBackupIfDue(new Date("2026-10-22T19:00:00Z"))).toBe(true);
    expect(google.uploadFile).toHaveBeenCalledTimes(1);
    expect(await runScheduledBackupIfDue(new Date("2026-10-22T19:10:00Z"))).toBe(false);
    expect(google.uploadFile).toHaveBeenCalledTimes(1);
  });

  it("waits an hour after a failure instead of retrying every tick", async () => {
    vi.mocked(google.uploadFile).mockRejectedValue(new Error("Drive is down"));
    const start = new Date("2026-10-22T19:00:00Z").getTime();
    expect(await runScheduledBackupIfDue(new Date(start))).toBe(false);
    const callsAfterFirst = vi.mocked(dumpDatabaseToGzipFile).mock.calls.length;
    await runScheduledBackupIfDue(new Date(start + 10 * 60_000));
    expect(vi.mocked(dumpDatabaseToGzipFile).mock.calls.length).toBe(callsAfterFirst);
    await runScheduledBackupIfDue(new Date(start + 61 * 60_000));
    expect(vi.mocked(dumpDatabaseToGzipFile).mock.calls.length).toBe(callsAfterFirst + 1);
  });

  it("does nothing when Drive is not connected", async () => {
    db.conn = null;
    expect(await runScheduledBackupIfDue(new Date("2026-10-22T19:00:00Z"))).toBe(false);
  });
});
