import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { BackupStatus } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/HttpError";
import { isMysqldumpHeader } from "../utils/dumpHeader";

const TRAILER = "-- Dump completed";
const TAIL_BYTES = 4096;
const CARRY_CHARS = 200;
const TABLE_RE = /CREATE TABLE (?:IF NOT EXISTS )?`([^`]+)`/g;
export const RESTORE_MAX_BYTES = 512 * 1024 * 1024;

/// Tables a usable backup of this system cannot be missing.
export const REQUIRED_TABLES = ["users", "products", "daily_online_stock", "daily_offline_stock", "manual_counts", "change_log"];

export interface DumpInspection {
  sizeBytes: number;
  /// SHA-256 of the bytes as read from `stream` (for a .gz file, of the SQL inside).
  sha256: string;
  headerOk: boolean;
  trailerOk: boolean;
  tables: string[];
}

/// Reads a dump once, front to back, without holding it in memory: size,
/// checksum, the mysqldump header, the closing "Dump completed" line (a dump
/// cut short by a full disk or dropped connection never gets one) and the
/// tables it creates.
export async function inspectDump(stream: Readable, maxBytes = RESTORE_MAX_BYTES): Promise<DumpInspection> {
  const hash = createHash("sha256");
  const tables = new Set<string>();
  let sizeBytes = 0;
  let head = Buffer.alloc(0);
  let tail = "";
  let carry = "";
  for await (const raw of stream) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    sizeBytes += chunk.length;
    if (sizeBytes > maxBytes) throw new HttpError(413, "That file is larger than the 512 MB restore limit.");
    hash.update(chunk);
    if (head.length < 256) head = Buffer.concat([head, chunk]).subarray(0, 256);
    const text = chunk.toString("latin1");
    tail = (tail + text).slice(-TAIL_BYTES);
    const scan = carry + text;
    for (const m of scan.matchAll(TABLE_RE)) tables.add(m[1]);
    carry = scan.slice(-CARRY_CHARS);
  }
  const headerText = head.toString("utf8").replace(/^\uFEFF/, "");
  return {
    sizeBytes,
    sha256: hash.digest("hex"),
    headerOk: isMysqldumpHeader(headerText),
    trailerOk: tail.includes(TRAILER),
    tables: [...tables].sort(),
  };
}

export interface BackupReport {
  ok: boolean;
  problems: string[];
  warnings: string[];
  sizeBytes: number;
  sha256: string;
  tableCount: number;
  missingTables: string[];
  /// A backup this system recorded with the same checksum, if any.
  known: { id: number; fileName: string; createdAt: Date } | null;
}

/// Turns an inspection into a verdict an admin can act on before relying on the
/// file: blocking `problems` mean "do not restore this", `warnings` are noted.
export async function buildReport(inspection: DumpInspection): Promise<BackupReport> {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (inspection.sizeBytes === 0) problems.push("The file is empty.");
  if (inspection.sizeBytes > 0 && !inspection.headerOk) problems.push("This isn't a mysqldump file made by this system's Download Backup.");
  if (inspection.headerOk && !inspection.trailerOk) problems.push('The file is incomplete: it has no closing "-- Dump completed" line (the backup was cut short).');
  const missingTables = inspection.headerOk ? REQUIRED_TABLES.filter((t) => !inspection.tables.includes(t)) : [];
  if (missingTables.length) problems.push(`Missing tables: ${missingTables.join(", ")}.`);

  const known = await prisma.backupRecord.findFirst({
    where: { sha256: inspection.sha256 },
    select: { id: true, fileName: true, createdAt: true },
    orderBy: { id: "desc" },
  });
  if (!known && problems.length === 0) {
    warnings.push("No backup with this checksum was recorded by this system (it may come from another server or have been edited).");
  }
  return {
    ok: problems.length === 0,
    problems,
    warnings,
    sizeBytes: inspection.sizeBytes,
    sha256: inspection.sha256,
    tableCount: inspection.tables.length,
    missingTables,
    known,
  };
}

export interface RecordBackupInput {
  fileName: string;
  trigger: "manual" | "scheduled" | "pre-restore" | "pre-migration";
  status: BackupStatus;
  sizeBytes?: number;
  sha256?: string;
  error?: string;
  createdById?: number | null;
  verified?: boolean;
  createdAt?: Date;
}

/// Best effort: a history row failing to write must never fail the backup
/// itself (the file has already reached the admin).
export async function recordBackup(input: RecordBackupInput): Promise<void> {
  try {
    await prisma.backupRecord.create({
      data: {
        fileName: input.fileName.slice(0, 200),
        trigger: input.trigger,
        status: input.status,
        sizeBytes: input.sizeBytes === undefined ? null : BigInt(input.sizeBytes),
        sha256: input.sha256 ?? null,
        error: input.error ? input.error.slice(0, 500) : null,
        createdById: input.createdById ?? null,
        verifiedAt: input.verified ? new Date() : null,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      },
    });
  } catch (err) {
    console.error("Could not record backup history:", err);
  }
}

export interface BackupFile {
  name: string;
  sizeBytes: number;
  modifiedAt: Date;
}

const BACKUP_FILE_RE = /\.(sql|sql\.gz)$/i;

/// Backups the scripts wrote to BACKUP_DIR (empty when it isn't configured).
export async function listBackupFiles(): Promise<BackupFile[]> {
  if (!env.backupDir) return [];
  let names: string[];
  try {
    names = await readdir(env.backupDir);
  } catch {
    return [];
  }
  const files: BackupFile[] = [];
  for (const name of names.filter((n) => BACKUP_FILE_RE.test(n))) {
    try {
      const s = await stat(path.join(env.backupDir, name));
      if (s.isFile()) files.push({ name, sizeBytes: s.size, modifiedAt: s.mtime });
    } catch {
      /* removed between readdir and stat */
    }
  }
  return files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime()).slice(0, 100);
}

/// Verifies one file from BACKUP_DIR in place. The name must be a plain file
/// name that is in the folder listing - never a path - so this cannot be
/// pointed at anything else on the server.
export async function verifyBackupFile(name: string, userId?: number | null): Promise<BackupReport & { fileName: string }> {
  const file = (await listBackupFiles()).find((f) => f.name === name);
  if (!file || !env.backupDir) throw HttpError.notFound("No such backup file.");
  const full = path.join(env.backupDir, file.name);
  const gz = /\.gz$/i.test(file.name);
  const source = createReadStream(full);
  const stream = gz ? source.pipe(createGunzip()) : source;
  if (gz) source.on("error", (e) => stream.destroy(e));
  let inspection: DumpInspection;
  try {
    inspection = await inspectDump(stream);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // A truncated or corrupt .gz fails to decompress - that is a verdict, not a crash.
    const report: BackupReport = {
      ok: false,
      problems: [`The archive could not be read: ${err instanceof Error ? err.message : "unknown error"}.`],
      warnings: [],
      sizeBytes: file.sizeBytes,
      sha256: "",
      tableCount: 0,
      missingTables: [],
      known: null,
    };
    await recordBackup({ fileName: file.name, trigger: "scheduled", status: "INVALID", sizeBytes: file.sizeBytes, error: report.problems[0], createdById: userId, verified: true, createdAt: file.modifiedAt });
    return { ...report, fileName: file.name };
  }
  const report = await buildReport(inspection);
  await recordBackup({
    fileName: file.name,
    trigger: "scheduled",
    status: report.ok ? "OK" : "INVALID",
    sizeBytes: file.sizeBytes,
    sha256: report.sha256,
    error: report.problems[0],
    createdById: userId,
    verified: true,
    createdAt: file.modifiedAt,
  });
  return { ...report, fileName: file.name };
}

export async function listBackupHistory(limit = 50) {
  const rows = await prisma.backupRecord.findMany({ orderBy: { id: "desc" }, take: limit });
  return rows.map((r) => ({ ...r, sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes) }));
}

/// When the last good backup was taken, from history and the backup folder,
/// and whether a newer attempt has failed since.
export async function backupHealth(now = new Date()) {
  const [lastOk, lastBad, files] = await Promise.all([
    prisma.backupRecord.findFirst({ where: { status: "OK" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.backupRecord.findFirst({ where: { status: { in: ["FAILED", "INVALID"] } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, fileName: true, error: true } }),
    listBackupFiles(),
  ]);
  const candidates = [lastOk?.createdAt, files[0]?.modifiedAt].filter((d): d is Date => !!d);
  const lastBackupAt = candidates.length ? new Date(Math.max(...candidates.map((d) => d.getTime()))) : null;
  const ageHours = lastBackupAt ? (now.getTime() - lastBackupAt.getTime()) / 3_600_000 : null;
  return {
    lastBackupAt,
    overdue: ageHours === null || ageHours > env.backupOverdueHours,
    overdueHours: env.backupOverdueHours,
    failedSince: lastBad && (!lastOk || lastBad.createdAt > lastOk.createdAt) ? lastBad : null,
  };
}
