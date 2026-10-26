import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "fs";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";

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

const db = vi.hoisted(() => ({
  conn: null as Record<string, unknown> | null,
  uploads: [] as Record<string, unknown>[],
  setting: null as { value: string } | null,
  /// Columns the (mock) drive_connection table has; a restore of an older dump has fewer.
  columns: null as string[] | null,
}));
vi.mock("../lib/prisma", () => ({
  prisma: {
    driveConnection: {
      findUnique: vi.fn(async () => db.conn),
      upsert: vi.fn(async ({ create, update }: { create: object; update: object }) => (db.conn = { ...(db.conn ?? {}), ...(db.conn ? update : create) })),
      update: vi.fn(async ({ data }: { data: object }) => (db.conn = { ...db.conn, ...data })),
      delete: vi.fn(async () => (db.conn = null)),
      deleteMany: vi.fn(async () => {
        db.conn = null;
      }),
    },
    $queryRaw: vi.fn(async () =>
      (db.columns ?? [
        "id", "accountEmail", "refreshTokenEnc", "backupFolderId", "exportFolderId", "autoBackup", "backupWeekday",
        "backupHourUtc", "keepBackups", "saveExports", "lastBackupAt", "lastError", "connectedById", "connectedAt", "updatedAt",
      ]).map((Field) => ({ Field })),
    ),
    // The raw INSERT used to write the connection back: read its column list and values.
    $executeRaw: vi.fn(async (q: { sql: string; values: unknown[] }) => {
      const names = [...q.sql.matchAll(/`(\w+)`/g)].map((m) => m[1]);
      db.conn = Object.fromEntries(names.map((n, i) => [n, q.values[i]]));
    }),
    appSetting: {
      findUnique: vi.fn(async () => db.setting),
      upsert: vi.fn(async ({ create }: { create: { value: string } }) => (db.setting = { value: create.value })),
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
  findFolders: vi.fn(),
  getFolder: vi.fn(),
  renameFolder: vi.fn(),
  uploadFile: vi.fn(),
  listFolder: vi.fn(),
  trashFile: vi.fn(),
  revokeToken: vi.fn(),
}));
vi.mock("./backup.service", () => ({ dumpDatabaseToGzipFile: vi.fn() }));
vi.mock("./backupVerify.service", () => ({ recordBackup: vi.fn() }));
vi.mock("./changeLog.service", () => ({ logSystemEvent: vi.fn() }));
const realtime = vi.hoisted(() => ({ broadcastNotice: vi.fn() }));
vi.mock("../lib/realtime", () => realtime);
const reports = vi.hoisted(() => ({ latestEntryDate: vi.fn(), buildDailyReportPdf: vi.fn() }));
vi.mock("./dailyReportPdf.service", () => reports);

import * as google from "../lib/googleDrive";
import { dumpDatabaseToGzipFile } from "./backup.service";
import { recordBackup } from "./backupVerify.service";
import { open } from "../utils/secretBox";
import {
  completeConnect,
  disconnect,
  keepDriveConnectionAcross,
  exportFileInfo,
  FOLDER_NAMES,
  isBackupDue,
  nextBackupAt,
  resetScheduleState,
  runBackup,
  queueDailyReportUpload,
  runScheduledBackupIfDue,
  saveDailyReports,
  syncFolderNames,
  syncFolderNamesIfDue,
  saveGeneratedReport,
  saveExport,
  startConnect,
} from "./drive.service";

const stateKey = `${JWT_SECRET}:drive-state`;
const stateFor = (payload: object, secret = stateKey, opts: jwt.SignOptions = { expiresIn: "10m" }) =>
  jwt.sign(payload, secret, { algorithm: "HS256", ...opts });

/// vi.clearAllMocks keeps queued one-shot results, so one test's leftover
/// "reject once" would fire in the next. These are re-armed below.
const resettable = [
  google.refreshAccessToken, google.uploadFile, google.listFolder, google.trashFile, google.createFolder, google.findFolders, google.getFolder, google.renameFolder,
  google.exchangeCode, google.fetchAccountEmail, google.revokeToken, dumpDatabaseToGzipFile, recordBackup,
];

beforeEach(async () => {
  vi.clearAllMocks();
  resettable.forEach((m) => vi.mocked(m).mockReset());
  db.conn = null;
  db.uploads = [];
  db.setting = null;
  reports.latestEntryDate.mockReset().mockResolvedValue(null);
  reports.buildDailyReportPdf.mockReset().mockResolvedValue(null);
  resetScheduleState();
  vi.mocked(google.refreshAccessToken).mockResolvedValue({ accessToken: "access-1", expiresIn: 3600 });
  vi.mocked(google.findFolders).mockResolvedValue([]);
  // By default every remembered folder exists and is already named right, so the
  // name check that runs after connecting has nothing to change.
  vi.mocked(google.getFolder).mockImplementation(async (_t, id) => ({
    id,
    name: id === "backups-folder" ? FOLDER_NAMES.backups : id === "exports-folder" ? FOLDER_NAMES.exports : FOLDER_NAMES.reports,
    trashed: false,
  }));
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
  Object.assign(db.conn!, { autoBackup: true, backupWeekday: 0, backupHourUtc: 18, keepBackups: 3, saveExports: true, lastBackupAt: null });
  db.columns = null;
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

  it("refuses a connection where the Drive permission was left unticked, before creating any folder", async () => {
    vi.mocked(google.createFolder).mockClear();
    vi.mocked(google.exchangeCode).mockResolvedValue({ accessToken: "a", refreshToken: "1//r", expiresIn: 3600, scope: "openid https://www.googleapis.com/auth/userinfo.email" });
    await expect(completeConnect("code", stateFor({ purpose: "drive-connect", uid: 7 }))).rejects.toThrow(/permission to create files and folders was left unticked/);
    expect(google.createFolder).not.toHaveBeenCalled();
  });

  it("accepts a connection where Drive was granted", async () => {
    vi.mocked(google.exchangeCode).mockResolvedValue({ accessToken: "a", refreshToken: "1//r", expiresIn: 3600, scope: "openid email https://www.googleapis.com/auth/drive.file" });
    vi.mocked(google.createFolder).mockResolvedValue("folder");
    await expect(completeConnect("code", stateFor({ purpose: "drive-connect", uid: 7 }))).resolves.toBeUndefined();
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
  Object.assign(db.conn!, { autoBackup: true, backupWeekday: 0, backupHourUtc: 18, keepBackups: 3, saveExports: true, lastBackupAt: null });
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

describe("Daily Report files (saved with the backup)", () => {
  const built = (date: string) => ({ fileName: `daily-report-${date}.pdf`, data: Buffer.from("pdf-bytes") });
  const folders = () => vi.mocked(google.createFolder).mock.calls.map((c) => [c[1], c[2]]);

  beforeEach(async () => {
    // Connected, and the backup itself already works (see the runBackup tests).
    vi.mocked(google.createFolder).mockResolvedValueOnce("backups-folder").mockResolvedValueOnce("exports-folder");
    await completeConnect("code", stateFor({ purpose: "drive-connect", uid: 7 }));
    vi.mocked(google.createFolder).mockReset();
    let n = 0;
    vi.mocked(google.createFolder).mockImplementation(async () => `folder-${++n}`);
    vi.mocked(google.listFolder).mockResolvedValue([]);
    reports.latestEntryDate.mockResolvedValue(new Date("2026-10-22T00:00:00Z"));
    reports.buildDailyReportPdf.mockImplementation(async (d: Date) => built(d.toISOString().slice(0, 10)));
  });

  const conn = () => db.conn as never;

  it("saves the latest day and the day before under Reports / year / month", async () => {
    await saveDailyReports(conn(), 7);
    // (The mocked listing never remembers what was made, so the second day
    // would make year and month again here; against real Drive it finds them.)
    expect(folders().slice(0, 3)).toEqual([
      ["Ala Eh Stock Monitoring - Reports", undefined],
      ["2026", "folder-1"],
      ["10", "folder-2"],
    ]);
    const names = vi.mocked(google.uploadFile).mock.calls.map((c) => c[1].name);
    expect(names).toEqual(["daily-report-2026-10-22.pdf", "daily-report-2026-10-21.pdf"]);
    expect(vi.mocked(google.uploadFile).mock.calls[0][1]).toMatchObject({
      parentId: "folder-3",
      mimeType: "application/pdf",
    });
    expect(db.uploads.filter((u) => u.kind === "report").map((u) => u.status)).toEqual(["OK", "OK"]);
  });

  it("remembers the Reports folder instead of creating another one next time", async () => {
    await saveDailyReports(conn());
    vi.mocked(google.createFolder).mockClear();
    await saveDailyReports(conn());
    expect(folders().filter(([name]) => name === "Ala Eh Stock Monitoring - Reports")).toHaveLength(0);
  });

  it("makes the Reports folder again when Google no longer knows the remembered one", async () => {
    db.setting = { value: "gone" };
    vi.mocked(google.listFolder).mockRejectedValueOnce(new google.DriveApiError("not found", 404));
    await saveDailyReports(conn());
    expect(folders()[0]).toEqual(["Ala Eh Stock Monitoring - Reports", undefined]);
    expect(db.setting).toEqual({ value: "folder-1" });
  });

  it("replaces that day's earlier file rather than leaving a second copy", async () => {
    vi.mocked(google.listFolder).mockImplementation(async (_t, parent) =>
      parent === "month-folder" ? [{ id: "old-1", name: "daily-report-2026-10-22.pdf", createdTime: "" }] : [],
    );
    db.setting = { value: "root" };
    vi.mocked(google.listFolder).mockImplementation(async (_t, parent) =>
      parent === "root"
        ? [{ id: "y", name: "2026", createdTime: "" }]
        : parent === "y"
          ? [{ id: "month-folder", name: "10", createdTime: "" }]
          : parent === "month-folder"
            ? [{ id: "old-1", name: "daily-report-2026-10-22.pdf", createdTime: "" }, { id: "other", name: "notes.txt", createdTime: "" }]
            : [],
    );
    await saveDailyReports(conn());
    expect(google.createFolder).not.toHaveBeenCalled(); // year and month were found, not remade
    expect(vi.mocked(google.trashFile).mock.calls.map((c) => c[1])).toContain("old-1");
    expect(vi.mocked(google.trashFile).mock.calls.map((c) => c[1])).not.toContain("other");
  });

  it("skips a day with nothing saved, and does nothing at all before any entry exists", async () => {
    reports.buildDailyReportPdf.mockImplementation(async (d: Date) => (d.toISOString().startsWith("2026-10-22") ? built("2026-10-22") : null));
    await saveDailyReports(conn());
    expect(vi.mocked(google.uploadFile).mock.calls.map((c) => c[1].name)).toEqual(["daily-report-2026-10-22.pdf"]);

    vi.mocked(google.uploadFile).mockClear();
    reports.latestEntryDate.mockResolvedValue(null);
    await saveDailyReports(conn());
    expect(google.uploadFile).not.toHaveBeenCalled();
  });

  it("never throws: a failed upload is recorded and the backup that called it stands", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(google.uploadFile).mockRejectedValue(new Error("Drive is full"));
    await expect(saveDailyReports(conn())).resolves.toBeUndefined();
    expect(db.uploads.find((u) => u.kind === "report")).toMatchObject({ status: "FAILED", error: "Drive is full" });
    warn.mockRestore();
  });

  it("runs after a successful backup, and a failure there does not fail the backup", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(dumpDatabaseToGzipFile).mockImplementation(async (path) => {
      writeFileSync(path, "gzipped-bytes");
      return { sizeBytes: 13, sha256: "abc", complete: true };
    });
    reports.latestEntryDate.mockRejectedValue(new Error("db hiccup"));
    await expect(runBackup("manual")).resolves.toMatchObject({ sizeBytes: 13 });
    expect(reports.latestEntryDate).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("a saved report goes to Drive straight away", () => {
  const built = (date: string) => ({ fileName: `daily-report-${date}.pdf`, data: Buffer.from("pdf-bytes") });
  const D = (iso: string) => new Date(`${iso}T00:00:00Z`);

  beforeEach(async () => {
    vi.mocked(google.createFolder).mockResolvedValueOnce("backups-folder").mockResolvedValueOnce("exports-folder");
    await completeConnect("code", stateFor({ purpose: "drive-connect", uid: 7 }));
    vi.mocked(google.createFolder).mockReset();
    let n = 0;
    vi.mocked(google.createFolder).mockImplementation(async () => `folder-${++n}`);
    vi.mocked(google.listFolder).mockResolvedValue([]);
    reports.buildDailyReportPdf.mockImplementation(async (d: Date) => built(d.toISOString().slice(0, 10)));
  });

  it("uploads just that day's PDF into Reports / year / month", async () => {
    await queueDailyReportUpload(D("2026-10-22"), 7);
    expect(vi.mocked(google.uploadFile).mock.calls.map((c) => c[1].name)).toEqual(["daily-report-2026-10-22.pdf"]);
    expect(reports.buildDailyReportPdf).toHaveBeenCalledTimes(1);
    expect(db.uploads.find((u) => u.kind === "report")).toMatchObject({ status: "OK", createdById: 7 });
  });

  it("does nothing when Drive is not connected", async () => {
    db.conn = null;
    await queueDailyReportUpload(D("2026-10-22"));
    expect(google.uploadFile).not.toHaveBeenCalled();
  });

  it("never throws, and records the failure", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(google.uploadFile).mockRejectedValue(new Error("Drive is full"));
    await expect(queueDailyReportUpload(D("2026-10-22"))).resolves.toBeUndefined();
    expect(db.uploads.find((u) => u.kind === "report")).toMatchObject({ status: "FAILED" });
    warn.mockRestore();
  });

  it("keeps two saves of the same day in order, so the older report cannot overwrite the newer one", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    reports.buildDailyReportPdf
      .mockImplementationOnce(async () => {
        order.push("first-start");
        await gate;
        order.push("first-end");
        return built("2026-10-22");
      })
      .mockImplementationOnce(async () => {
        order.push("second-start");
        return built("2026-10-22");
      });
    const first = queueDailyReportUpload(D("2026-10-22"));
    const second = queueDailyReportUpload(D("2026-10-22"));
    await vi.waitFor(() => expect(order).toContain("first-start"));
    expect(order).not.toContain("second-start"); // still waiting its turn
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("lets different days upload independently", async () => {
    await Promise.all([queueDailyReportUpload(D("2026-10-21")), queueDailyReportUpload(D("2026-10-22"))]);
    expect(google.uploadFile).toHaveBeenCalledTimes(2);
  });
});

describe("Drive folders: exact names, and never a second folder of a name", () => {
  const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const folder = (id: string, name: string, trashed = false) => ({ id, name, trashed });

  it("uses exactly these three names", () => {
    expect(FOLDER_NAMES).toEqual({
      backups: "Ala Eh Stock Monitoring - Backups",
      exports: "Ala Eh Stock Monitoring - Exports",
      reports: "Ala Eh Stock Monitoring - Reports",
    });
  });

  describe("when Drive is connected for the first time", () => {
    const connect = () => completeConnect("code", stateFor({ purpose: "drive-connect", uid: 7 }));

    // The suite's own setup already connected once; these are first connections.
    beforeEach(() => {
      db.conn = null;
      vi.mocked(google.createFolder).mockReset();
      vi.mocked(google.renameFolder).mockClear();
      vi.mocked(google.findFolders).mockResolvedValue([]);
      // Whichever of these ids the connection ends up with is, by then, named right.
      const rightName: Record<string, string> = {
        b: FOLDER_NAMES.backups, "old-b": FOLDER_NAMES.backups, oldest: FOLDER_NAMES.backups, "legacy-b": FOLDER_NAMES.backups,
        e: FOLDER_NAMES.exports, "old-e": FOLDER_NAMES.exports, "legacy-e": FOLDER_NAMES.exports,
      };
      vi.mocked(google.getFolder).mockImplementation(async (_t, id) => ({ id, name: rightName[id] ?? "", trashed: false }));
    });

    it("creates the Backups and Exports folders under the exact names when none exist", async () => {
      vi.mocked(google.createFolder).mockResolvedValueOnce("b").mockResolvedValueOnce("e");
      await connect();
      expect(vi.mocked(google.createFolder).mock.calls.map((c) => c[1])).toEqual([FOLDER_NAMES.backups, FOLDER_NAMES.exports]);
    });

    it("reuses a folder that already has the name instead of making another", async () => {
      vi.mocked(google.findFolders).mockImplementation(async (_t, name) =>
        name === FOLDER_NAMES.backups ? [folder("old-b", name)] : name === FOLDER_NAMES.exports ? [folder("old-e", name)] : [],
      );
      await connect();
      expect(google.createFolder).not.toHaveBeenCalled();
      expect(db.conn).toMatchObject({ backupFolderId: "old-b", exportFolderId: "old-e" });
    });

    it("takes the oldest when strays share the name, and does not make a new one", async () => {
      vi.mocked(google.findFolders).mockImplementation(async (_t, name) =>
        name === FOLDER_NAMES.backups ? [folder("oldest", name), folder("newer", name)] : [folder("e", name)],
      );
      await connect();
      expect(db.conn).toMatchObject({ backupFolderId: "oldest" });
      expect(google.createFolder).not.toHaveBeenCalled();
    });

    it("renames a folder made under an older name rather than creating a new one beside it", async () => {
      vi.mocked(google.findFolders).mockImplementation(async (_t, name) =>
        name === "Ala Eh Monitoring - Backups" ? [folder("legacy-b", name)] : name === "Ala Eh Monitoring - Exports" ? [folder("legacy-e", name)] : [],
      );
      await connect();
      expect(google.createFolder).not.toHaveBeenCalled();
      expect(vi.mocked(google.renameFolder).mock.calls.map((c) => [c[1], c[2]])).toEqual([
        ["legacy-b", FOLDER_NAMES.backups],
        ["legacy-e", FOLDER_NAMES.exports],
      ]);
      expect(db.conn).toMatchObject({ backupFolderId: "legacy-b", exportFolderId: "legacy-e" });
    });
  });

  describe("syncFolderNames (existing folders)", () => {
    beforeEach(async () => {
      vi.mocked(google.createFolder).mockResolvedValueOnce("backups-folder").mockResolvedValueOnce("exports-folder");
      await completeConnect("code", stateFor({ purpose: "drive-connect", uid: 7 }));
      vi.mocked(google.createFolder).mockReset();
      vi.mocked(google.createFolder).mockResolvedValue("created");
      vi.mocked(google.renameFolder).mockClear();
    });

    it("changes nothing when every folder already has its exact name", async () => {
      expect(await syncFolderNames()).toEqual({ renamed: [], adopted: [], recreated: [] });
      expect(google.renameFolder).not.toHaveBeenCalled();
      expect(google.createFolder).not.toHaveBeenCalled();
    });

    it("renames old-named folders in place - same id, so every file already in them stays where it is", async () => {
      vi.mocked(google.getFolder).mockImplementation(async (_t, id) =>
        folder(id, id === "backups-folder" ? "Ala Eh Monitoring - Backups" : "Ala Eh Monitoring - Exports"),
      );
      const result = await syncFolderNames();
      expect(result?.renamed).toEqual(["Ala Eh Monitoring - Backups -> " + FOLDER_NAMES.backups, "Ala Eh Monitoring - Exports -> " + FOLDER_NAMES.exports]);
      expect(vi.mocked(google.renameFolder).mock.calls.map((c) => [c[1], c[2]])).toEqual([
        ["backups-folder", FOLDER_NAMES.backups],
        ["exports-folder", FOLDER_NAMES.exports],
      ]);
      expect(google.createFolder).not.toHaveBeenCalled();
      expect(db.conn).toMatchObject({ backupFolderId: "backups-folder", exportFolderId: "exports-folder" });
    });

    it("renames the Reports folder too, whichever old name it had", async () => {
      db.setting = { value: "reports-folder" };
      vi.mocked(google.getFolder).mockImplementation(async (_t, id) =>
        folder(id, id === "reports-folder" ? "Ala Eh Stocks Monitoring - Reports" : id === "backups-folder" ? FOLDER_NAMES.backups : FOLDER_NAMES.exports),
      );
      const result = await syncFolderNames();
      expect(result?.renamed).toEqual(["Ala Eh Stocks Monitoring - Reports -> " + FOLDER_NAMES.reports]);
      expect(google.renameFolder).toHaveBeenCalledWith("access-1", "reports-folder", FOLDER_NAMES.reports);
      expect(db.setting).toEqual({ value: "reports-folder" });
    });

    it("never renames into a name another folder already has - it uses that folder and leaves the old one alone", async () => {
      vi.mocked(google.getFolder).mockImplementation(async (_t, id) =>
        folder(id, id === "backups-folder" ? "Ala Eh Monitoring - Backups" : FOLDER_NAMES.exports),
      );
      vi.mocked(google.findFolders).mockImplementation(async (_t, name) => (name === FOLDER_NAMES.backups ? [folder("already-named", name)] : []));
      const result = await syncFolderNames();
      expect(result?.adopted).toEqual([FOLDER_NAMES.backups]);
      expect(google.renameFolder).not.toHaveBeenCalled();
      expect(db.conn).toMatchObject({ backupFolderId: "already-named" });
    });

    it("finds a folder that has gone by name, and makes one only if none exists", async () => {
      vi.mocked(google.getFolder).mockImplementation(async (_t, id) => (id === "backups-folder" ? null : folder(id, FOLDER_NAMES.exports)));
      vi.mocked(google.findFolders).mockImplementation(async (_t, name) => (name === FOLDER_NAMES.backups ? [folder("found", name)] : []));
      expect((await syncFolderNames())?.recreated).toEqual([FOLDER_NAMES.backups]);
      expect(db.conn).toMatchObject({ backupFolderId: "found" });
      expect(google.createFolder).not.toHaveBeenCalled();

      vi.mocked(google.getFolder).mockImplementation(async (_t, id) => (id === "found" ? folder("found", FOLDER_NAMES.backups, true) : folder(id, FOLDER_NAMES.exports)));
      vi.mocked(google.findFolders).mockResolvedValue([]);
      await syncFolderNames();
      expect(vi.mocked(google.createFolder).mock.calls.map((c) => c[1])).toEqual([FOLDER_NAMES.backups]); // a trashed folder counts as gone
    });

    it("does not make a Reports folder for a system that has never saved a report", async () => {
      db.setting = null;
      await syncFolderNames();
      expect(google.createFolder).not.toHaveBeenCalled();
    });

    it("does nothing when Drive is not connected, and never throws when Google fails", async () => {
      const warn = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(google.getFolder).mockRejectedValue(new Error("Drive is down"));
      await expect(syncFolderNames()).resolves.toBeNull();
      db.conn = null;
      await expect(syncFolderNames()).resolves.toBeNull();
      warn.mockRestore();
    });

    it("is checked at most once an hour by the scheduler", async () => {
      const start = new Date("2026-10-22T10:00:00Z");
      expect(await syncFolderNamesIfDue(start)).toBe(true);
      expect(await syncFolderNamesIfDue(new Date(start.getTime() + 30 * 60_000))).toBe(false);
      expect(await syncFolderNamesIfDue(new Date(start.getTime() + 61 * 60_000))).toBe(true);
    });
  });

  describe("reports for different dates saved at the same moment", () => {
    it("share one year folder and one month folder - never two of the same name", async () => {
      // Drive as a real folder tree: what createFolder makes, listFolder then sees.
      const tree = new Map<string, { id: string; name: string }[]>([["root", [{ id: "y-old", name: "2025" }]]]);
      let n = 0;
      db.setting = { value: "root" };
      vi.mocked(google.listFolder).mockImplementation(async (_t, parent) => (tree.get(parent) ?? []).map((f) => ({ ...f, createdTime: "" })));
      vi.mocked(google.createFolder).mockImplementation(async (_t, name, parent) => {
        await new Promise((r) => setTimeout(r, 5)); // a slow create, so a racing second one would overlap it
        const id = `new-${++n}`;
        tree.set(parent ?? "root", [...(tree.get(parent ?? "root") ?? []), { id, name }]);
        return id;
      });
      reports.buildDailyReportPdf.mockImplementation(async (d: Date) => ({ fileName: `daily-report-${d.toISOString().slice(0, 10)}.pdf`, data: Buffer.from(d.toISOString()) }));
      vi.mocked(google.createFolder).mockClear();

      await Promise.all([saveGeneratedReport(D("2026-10-21"), 7), saveGeneratedReport(D("2026-10-22"), 7), saveGeneratedReport(D("2026-10-23"), 7)]);

      const made = vi.mocked(google.createFolder).mock.calls.map((c) => c[1]);
      expect(made.filter((name) => name === "2026")).toHaveLength(1);
      expect(made.filter((name) => name === "10")).toHaveLength(1);
      expect(google.uploadFile).toHaveBeenCalledTimes(3);
    });
  });
});

describe("one file per day in Drive: Generate saves it, and never twice", () => {
  const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const bytes = Buffer.from("pdf-bytes-v1");
  const md5 = (b: Buffer) => createHash("md5").update(b).digest("hex");
  const FILE = "daily-report-2026-10-22.pdf";

  /// Drive as it stands: root > 2026 > 10, and what is in the month folder.
  const driveHolds = (files: { id: string; name: string; md5Checksum?: string }[]) => {
    db.setting = { value: "root" };
    vi.mocked(google.listFolder).mockImplementation(async (_t, parent) =>
      parent === "root"
        ? [{ id: "y", name: "2026", createdTime: "" }]
        : parent === "y"
          ? [{ id: "m", name: "10", createdTime: "" }]
          : parent === "m"
            ? files.map((f) => ({ createdTime: "", ...f }))
            : [],
    );
  };

  beforeEach(async () => {
    vi.mocked(google.createFolder).mockResolvedValueOnce("backups-folder").mockResolvedValueOnce("exports-folder");
    await completeConnect("code", stateFor({ purpose: "drive-connect", uid: 7 }));
    vi.mocked(google.createFolder).mockReset();
    vi.mocked(google.createFolder).mockResolvedValue("folder");
    reports.buildDailyReportPdf.mockResolvedValue({ fileName: FILE, data: bytes });
    realtime.broadcastNotice.mockClear();
  });

  it("uploads the first time a date is generated", async () => {
    driveHolds([]);
    await expect(saveGeneratedReport(D("2026-10-22"), 7)).resolves.toBe("saved");
    expect(vi.mocked(google.uploadFile).mock.calls.map((c) => c[1].name)).toEqual([FILE]);
    expect(vi.mocked(google.uploadFile).mock.calls[0][1]).toMatchObject({ parentId: "m" });
  });

  it("does not upload again when Drive already holds exactly this file", async () => {
    driveHolds([{ id: "f1", name: FILE, md5Checksum: md5(bytes) }]);
    await expect(saveGeneratedReport(D("2026-10-22"), 7)).resolves.toBe("unchanged");
    expect(google.uploadFile).not.toHaveBeenCalled();
    expect(google.trashFile).not.toHaveBeenCalled();
    expect(db.uploads.filter((u) => u.kind === "report")).toEqual([]); // nothing was sent, so nothing is logged as sent
  });

  it("replaces the file when the report has changed, trashing the old one", async () => {
    driveHolds([{ id: "f1", name: FILE, md5Checksum: md5(Buffer.from("an older report")) }]);
    await expect(saveGeneratedReport(D("2026-10-22"), 7)).resolves.toBe("saved");
    expect(vi.mocked(google.trashFile).mock.calls.map((c) => c[1])).toEqual(["f1"]);
    expect(google.uploadFile).toHaveBeenCalledTimes(1);
  });

  it("tidies stray extra copies, keeping the identical one", async () => {
    driveHolds([
      { id: "dup-1", name: FILE, md5Checksum: md5(Buffer.from("old")) },
      { id: "keep", name: FILE, md5Checksum: md5(bytes) },
      { id: "dup-2", name: FILE, md5Checksum: md5(Buffer.from("older")) },
      { id: "other-day", name: "daily-report-2026-10-21.pdf", md5Checksum: "x" },
    ]);
    await expect(saveGeneratedReport(D("2026-10-22"), 7)).resolves.toBe("unchanged");
    expect(vi.mocked(google.trashFile).mock.calls.map((c) => c[1]).sort()).toEqual(["dup-1", "dup-2"]);
    expect(google.uploadFile).not.toHaveBeenCalled();
  });

  it("collapses several stray copies into one when none is identical", async () => {
    driveHolds([
      { id: "a", name: FILE, md5Checksum: "1" },
      { id: "b", name: FILE, md5Checksum: "2" },
    ]);
    await saveGeneratedReport(D("2026-10-22"), 7);
    expect(vi.mocked(google.trashFile).mock.calls.map((c) => c[1]).sort()).toEqual(["a", "b"]);
    expect(google.uploadFile).toHaveBeenCalledTimes(1);
  });

  it("generating the same date twice in a row uploads once, however quickly", async () => {
    let held: { id: string; name: string; md5Checksum?: string }[] = [];
    driveHolds([]);
    vi.mocked(google.listFolder).mockImplementation(async (_t, parent) =>
      parent === "root"
        ? [{ id: "y", name: "2026", createdTime: "" }]
        : parent === "y"
          ? [{ id: "m", name: "10", createdTime: "" }]
          : held.map((f) => ({ createdTime: "", ...f })),
    );
    vi.mocked(google.uploadFile).mockImplementation(async (_t, input) => {
      held = [{ id: "new", name: input.name, md5Checksum: md5(bytes) }];
      return "new";
    });
    const results = await Promise.all([saveGeneratedReport(D("2026-10-22"), 7), saveGeneratedReport(D("2026-10-22"), 7)]);
    expect(results).toEqual(["saved", "unchanged"]);
    expect(google.uploadFile).toHaveBeenCalledTimes(1);
  });

  it("says there is nothing to keep for a date with no saved entries, and for Drive not connected", async () => {
    driveHolds([]);
    reports.buildDailyReportPdf.mockResolvedValue(null);
    await expect(saveGeneratedReport(D("2026-10-22"), 7)).resolves.toBe("empty");
    expect(google.uploadFile).not.toHaveBeenCalled();
    db.conn = null;
    await expect(saveGeneratedReport(D("2026-10-22"), 7)).resolves.toBe("not-connected");
  });

  it("lets a Drive failure reach the person who asked, and tells nobody else", async () => {
    driveHolds([]);
    vi.mocked(google.uploadFile).mockRejectedValue(new Error("Drive is full"));
    await expect(saveGeneratedReport(D("2026-10-22"), 7)).rejects.toThrow("Drive is full");
    expect(db.uploads.find((u) => u.kind === "report")).toMatchObject({ status: "FAILED" });
    expect(realtime.broadcastNotice).not.toHaveBeenCalled();
  });

  it("a failed generate does not block the next one for that date", async () => {
    driveHolds([]);
    vi.mocked(google.uploadFile).mockRejectedValueOnce(new Error("blip"));
    await expect(saveGeneratedReport(D("2026-10-22"), 7)).rejects.toThrow("blip");
    vi.mocked(google.uploadFile).mockResolvedValue("ok");
    await expect(saveGeneratedReport(D("2026-10-22"), 7)).resolves.toBe("saved");
  });

  it("does not toast admins for a file Drive already had, but does for a new one (finish-day path)", async () => {
    driveHolds([{ id: "f1", name: FILE, md5Checksum: md5(bytes) }]);
    await queueDailyReportUpload(D("2026-10-22"));
    expect(realtime.broadcastNotice).not.toHaveBeenCalled();
    driveHolds([]);
    await queueDailyReportUpload(D("2026-10-22"));
    expect(realtime.broadcastNotice).toHaveBeenCalledTimes(1);
  });
});

describe("toasts for what the server saves to Drive on its own", () => {
  const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const connect = async () => {
    vi.mocked(google.createFolder).mockResolvedValueOnce("backups-folder").mockResolvedValueOnce("exports-folder");
    await completeConnect("code", stateFor({ purpose: "drive-connect", uid: 7 }));
    vi.mocked(google.createFolder).mockReset();
    vi.mocked(google.createFolder).mockResolvedValue("folder");
    vi.mocked(google.listFolder).mockResolvedValue([]);
    vi.mocked(dumpDatabaseToGzipFile).mockImplementation(async (path) => {
      writeFileSync(path, "gzipped-bytes");
      return { sizeBytes: 3_145_728, sha256: "abc", complete: true };
    });
    realtime.broadcastNotice.mockClear();
  };

  it("announces a scheduled backup to the admins, and only that one", async () => {
    await connect();
    await runBackup("scheduled");
    expect(realtime.broadcastNotice).toHaveBeenCalledTimes(1);
    expect(realtime.broadcastNotice).toHaveBeenCalledWith(
      { level: "success", message: expect.stringMatching(/Google Drive backup saved: ala-eh-backup-.*\.sql\.gz \(3\.0 MB\)/) },
      ["SUPERVISOR_ADMIN"],
    );
  });

  it("does not announce a backup someone asked for - they get the answer directly", async () => {
    await connect();
    await runBackup("manual", 7);
    expect(realtime.broadcastNotice).not.toHaveBeenCalled();
  });

  it("announces a failed scheduled backup as an error", async () => {
    await connect();
    vi.mocked(google.uploadFile).mockRejectedValue(new Error("Quota exceeded"));
    await expect(runBackup("scheduled")).rejects.toThrow("Quota exceeded");
    expect(realtime.broadcastNotice).toHaveBeenCalledWith({ level: "error", message: expect.stringContaining("Quota exceeded") }, ["SUPERVISOR_ADMIN"]);
  });

  it("announces a saved Daily Report, and a failed one", async () => {
    await connect();
    reports.buildDailyReportPdf.mockResolvedValue({ fileName: "daily-report-2026-10-22.pdf", data: Buffer.from("x") });
    await queueDailyReportUpload(D("2026-10-22"));
    expect(realtime.broadcastNotice).toHaveBeenLastCalledWith({ level: "success", message: "Daily Report for 2026-10-22 saved to Google Drive." }, ["SUPERVISOR_ADMIN"]);

    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(google.uploadFile).mockRejectedValue(new Error("Drive is full"));
    await queueDailyReportUpload(D("2026-10-22"));
    expect(realtime.broadcastNotice).toHaveBeenLastCalledWith({ level: "error", message: expect.stringContaining("Drive is full") }, ["SUPERVISOR_ADMIN"]);
    warn.mockRestore();
  });

  it("says nothing for a day with no report to save", async () => {
    await connect();
    reports.buildDailyReportPdf.mockResolvedValue(null);
    await queueDailyReportUpload(D("2026-10-22"));
    expect(realtime.broadcastNotice).not.toHaveBeenCalled();
  });

  it("does not toast once per catch-up report inside a backup", async () => {
    await connect();
    reports.latestEntryDate.mockResolvedValue(D("2026-10-22"));
    reports.buildDailyReportPdf.mockImplementation(async (d: Date) => ({ fileName: `daily-report-${d.toISOString().slice(0, 10)}.pdf`, data: Buffer.from("x") }));
    await runBackup("scheduled");
    expect(realtime.broadcastNotice).toHaveBeenCalledTimes(1); // the backup, not its two reports
  });
});

describe("isBackupDue (weekly, Sunday cases)", () => {
  const at = (iso: string) => new Date(iso);
  const conn = (lastBackupAt: string | null, backupHourUtc = 18, autoBackup = true, backupWeekday = 0) => ({
    autoBackup,
    backupWeekday,
    backupHourUtc,
    lastBackupAt: lastBackupAt ? at(lastBackupAt) : null,
  });
  // 2026-10-25 is a Sunday.

  it("is due once Sunday has reached the set hour with no backup since the Sunday before", () => {
    expect(isBackupDue(conn("2026-10-18T18:05:00Z"), at("2026-10-25T18:00:00Z"))).toBe(true);
    expect(isBackupDue(conn("2026-10-18T18:05:00Z"), at("2026-10-26T03:00:00Z"))).toBe(true);
  });

  it("is not due during the week, or before the hour on Sunday", () => {
    expect(isBackupDue(conn("2026-10-18T18:05:00Z"), at("2026-10-21T20:00:00Z"))).toBe(false);
    expect(isBackupDue(conn("2026-10-18T18:05:00Z"), at("2026-10-25T17:59:00Z"))).toBe(false);
    expect(isBackupDue(conn("2026-10-18T18:05:00Z"), at("2026-10-24T23:59:00Z"))).toBe(false); // Saturday night
  });

  it("is not due again after the backup that covered this week's slot", () => {
    expect(isBackupDue(conn("2026-10-25T18:05:00Z"), at("2026-10-27T09:00:00Z"))).toBe(false);
    expect(isBackupDue(conn("2026-10-25T18:05:00Z"), at("2026-11-01T17:00:00Z"))).toBe(false);
    expect(isBackupDue(conn("2026-10-25T18:05:00Z"), at("2026-11-01T18:00:00Z"))).toBe(true);
  });

  it("finds the Sunday across a month and a year boundary", () => {
    expect(isBackupDue(conn("2026-12-27T18:05:00Z"), at("2027-01-02T23:00:00Z"))).toBe(false);
    expect(isBackupDue(conn("2026-12-27T18:05:00Z"), at("2027-01-03T18:00:00Z"))).toBe(true); // 2027-01-03 is a Sunday
    expect(isBackupDue(conn("2028-02-20T18:05:00Z"), at("2028-02-27T18:00:00Z"))).toBe(true); // leap year, still Sunday
  });

  it("honours a different hour", () => {
    expect(isBackupDue(conn("2026-10-18T02:05:00Z", 2), at("2026-10-25T02:00:00Z"))).toBe(true);
    expect(isBackupDue(conn("2026-10-18T02:05:00Z", 2), at("2026-10-25T01:59:00Z"))).toBe(false);
  });

  it("a manual backup mid-week does not bring the scheduled one forward", () => {
    expect(isBackupDue(conn("2026-10-21T10:00:00Z"), at("2026-10-24T20:00:00Z"))).toBe(false);
    expect(isBackupDue(conn("2026-10-21T10:00:00Z"), at("2026-10-25T18:00:00Z"))).toBe(true);
  });

  it("catches up after downtime: a missed Sunday is due as soon as the server is back", () => {
    expect(isBackupDue(conn("2026-10-04T18:05:00Z"), at("2026-10-22T09:00:00Z"))).toBe(true);
  });

  it("is due straight away for a connection that has never been backed up", () => {
    expect(isBackupDue(conn(null), at("2026-10-21T03:00:00Z"))).toBe(true);
  });

  it("is never due when automatic backups are off", () => {
    expect(isBackupDue(conn(null, 18, false), at("2026-10-25T20:00:00Z"))).toBe(false);
  });
});

describe("nextBackupAt", () => {
  it("on Sunday: is this Sunday at the hour, or next Sunday's once that has passed", () => {
    expect(nextBackupAt(18, new Date("2026-10-22T09:00:00Z"), 0).toISOString()).toBe("2026-10-25T18:00:00.000Z");
    expect(nextBackupAt(18, new Date("2026-10-25T17:59:00Z"), 0).toISOString()).toBe("2026-10-25T18:00:00.000Z");
    expect(nextBackupAt(18, new Date("2026-10-25T18:00:00Z"), 0).toISOString()).toBe("2026-11-01T18:00:00.000Z");
    expect(nextBackupAt(18, new Date("2026-12-30T19:00:00Z"), 0).toISOString()).toBe("2027-01-03T18:00:00.000Z");
    expect(nextBackupAt(2, new Date("2028-02-24T00:00:00Z"), 0).toISOString()).toBe("2028-02-27T02:00:00.000Z");
  });

  it("is always a Sunday", () => {
    for (const day of [20, 21, 22, 23, 24, 25, 26, 27]) {
      expect(nextBackupAt(18, new Date(`2026-10-${day}T05:00:00Z`), 0).getUTCDay()).toBe(0);
    }
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

describe("the weekly backup day", () => {
  const at = (iso: string) => new Date(iso);
  const conn = (lastBackupAt: string | null, backupWeekday: number) => ({
    autoBackup: true,
    backupWeekday,
    backupHourUtc: 18,
    lastBackupAt: lastBackupAt ? at(lastBackupAt) : null,
  });
  // 2026-10-24 is a Saturday, 2026-10-23 a Friday.

  it("runs on Saturday when Saturday is chosen, and not on the days before it", () => {
    expect(isBackupDue(conn("2026-10-17T18:05:00Z", 6), at("2026-10-24T17:59:00Z"))).toBe(false);
    expect(isBackupDue(conn("2026-10-17T18:05:00Z", 6), at("2026-10-24T18:00:00Z"))).toBe(true);
    expect(isBackupDue(conn("2026-10-17T18:05:00Z", 6), at("2026-10-22T20:00:00Z"))).toBe(false);
  });

  it("once Saturday's backup is done it stays done until the next Saturday", () => {
    expect(isBackupDue(conn("2026-10-24T18:05:00Z", 6), at("2026-10-30T23:00:00Z"))).toBe(false);
    expect(isBackupDue(conn("2026-10-24T18:05:00Z", 6), at("2026-10-31T18:00:00Z"))).toBe(true);
  });

  it("catches up after downtime: a missed Saturday is still due on the following Tuesday", () => {
    expect(isBackupDue(conn("2026-10-17T18:05:00Z", 6), at("2026-10-27T09:00:00Z"))).toBe(true);
  });

  it("the default (Friday 18:00 UTC) lands on Saturday 2:00 AM in the Philippines", () => {
    const next = nextBackupAt(18, at("2026-10-20T00:00:00Z"), 5);
    expect(next.toISOString()).toBe("2026-10-23T18:00:00.000Z");
    expect(new Date(next.getTime() + 8 * 3600_000).getUTCDay()).toBe(6);
  });

  it("nextBackupAt is always on the chosen day, for every day of the week", () => {
    for (let weekday = 0; weekday < 7; weekday++) {
      for (const day of [20, 21, 22, 23, 24, 25, 26, 27]) {
        expect(nextBackupAt(18, at(`2026-10-${day}T05:00:00Z`), weekday).getUTCDay()).toBe(weekday);
      }
    }
  });

  it("works across a month and year boundary", () => {
    expect(nextBackupAt(18, at("2026-12-30T00:00:00Z"), 6).toISOString()).toBe("2027-01-02T18:00:00.000Z");
  });
});

describe("keepDriveConnectionAcross (a database restore)", () => {
  it("puts this server's own connection back when the restored file held a different one", async () => {
    const mine = { ...db.conn! };
    await keepDriveConnectionAcross(async () => {
      // The restore overwrites the table with the backup file's row.
      db.conn = { ...mine, accountEmail: "someone-else@gmail.com", refreshTokenEnc: "v1.stale.token.sealed-by-another-key", backupFolderId: "foreign-folder" };
    });
    expect(db.conn).toEqual(mine);
  });

  it("still puts it back when the restored table is an OLDER one without the newest column", async () => {
    const mine = { ...db.conn! };
    await keepDriveConnectionAcross(async () => {
      // A dump taken before the backupWeekday migration brings back the old table shape.
      db.columns = Object.keys(mine).filter((c) => c !== "backupWeekday");
      db.conn = null;
    });
    const { backupWeekday: _newest, ...rest } = mine;
    expect(db.conn).toEqual(rest);
    expect(db.conn).not.toHaveProperty("backupWeekday");
    expect((db.conn as { refreshTokenEnc: string }).refreshTokenEnc).toBe(mine.refreshTokenEnc as string);
  });

  it("removes a connection that came from the file when this server had none", async () => {
    await disconnect(7);
    expect(db.conn).toBeNull();
    await keepDriveConnectionAcross(async () => {
      db.conn = { id: 1, accountEmail: "from-the-file@gmail.com", refreshTokenEnc: "v1.x.y.z" };
    });
    expect(db.conn).toBeNull();
  });

  it("keeps the connection even when the restore itself fails, and still reports that failure", async () => {
    const mine = { ...db.conn! };
    await expect(
      keepDriveConnectionAcross(async () => {
        db.conn = null; // half the tables replaced, the connection row already gone
        throw new Error("mysql stopped partway");
      }),
    ).rejects.toThrow("mysql stopped partway");
    expect(db.conn).toEqual(mine);
  });

  it("forgets the cached access token so the next call uses the kept connection", async () => {
    await runBackup("manual"); // makes sure an access token is cached
    vi.mocked(google.refreshAccessToken).mockClear();
    await runBackup("manual");
    expect(google.refreshAccessToken).not.toHaveBeenCalled(); // served from the cache
    await keepDriveConnectionAcross(async () => undefined);
    await runBackup("manual");
    expect(google.refreshAccessToken).toHaveBeenCalledTimes(1); // the cache was dropped, so it refreshed
  });

  it("returns whatever the restore returns", async () => {
    await expect(keepDriveConnectionAcross(async () => 42)).resolves.toBe(42);
  });
});
