import { invalidateAll } from "../lib/cache";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { spawn } from "child_process";
import type { Request, Response } from "express";
import { createHash } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";
import { env } from "../config/env";
import { HttpError } from "../utils/HttpError";
import { isMysqldumpHeader } from "../utils/dumpHeader";
import { createBackupDecryptor, createBackupEncryptor } from "../utils/backupCrypto";
const RESTORE_MAX_BYTES = 512 * 1024 * 1024;
const RESTORE_TIMEOUT_MS = 10 * 60 * 1000;

function parseDatabaseUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port || "3306",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
  };
}

function mysqldumpArgs(c: { host: string; port: string; user: string; database: string }): string[] {
  return [
    "--host", c.host, "--port", c.port, "--user", c.user,
    "--single-transaction", "--routines", "--triggers",
    // MySQL 8 otherwise demands the server-wide PROCESS privilege just to
    // dump tablespace metadata, which an app-level DB user rarely has.
    "--no-tablespaces",
    c.database,
  ];
}

/// Section Admin - Database Backup. Streams a full `mysqldump` of the app's
/// database straight to the HTTP response so a SUPERVISOR_ADMIN can pull an
/// offline copy from the browser, with no shell access to the DB server
/// required. The password goes in via MYSQL_PWD (an env var only this child
/// process sees) rather than a --password flag, which would otherwise be
/// visible to anyone who can list processes on the host. Requires the MySQL
/// client tools (`mysqldump`) to be installed on whatever machine runs this
/// server - that's a deploy-time dependency, not something this app can
/// install for itself.
export interface BackupStreamSummary {
  sizeBytes: number;
  sha256: string;
  /// mysqldump's closing "-- Dump completed" line was seen - the file is whole.
  complete: boolean;
}

export function streamDatabaseBackup(res: Response, filename: string): Promise<BackupStreamSummary> {
  const { host, port, user, password, database } = parseDatabaseUrl(env.databaseUrl);

  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let sizeBytes = 0;
    let tail = "";
    const dump = spawn(env.mysqldumpPath, mysqldumpArgs({ host, port, user, database }), { env: { ...process.env, MYSQL_PWD: password } });
    // With a backup key the browser receives the encrypted container, never the plain dump.
    const sink: NodeJS.WritableStream = env.backupEncryptionKey ? createBackupEncryptor(env.backupEncryptionKey) : res;
    if (sink !== res) {
      (sink as NodeJS.ReadWriteStream).pipe(res);
      // An encryption failure must end the download (a truncated file the browser keeps would
      // look like a finished backup), not just stop the dump.
      sink.on("error", () => {
        dump.kill();
        res.destroy();
      });
    }

    let stderr = "";
    dump.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    dump.on("error", (err) => {
      reject(
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new HttpError(500, "mysqldump isn't installed on this server (or MYSQLDUMP_PATH is wrong) - install the MySQL client tools to enable database backups.")
          : err,
      );
    });

    // The download headers go out only once real dump output exists, so a
    // dump that fails immediately (bad credentials, missing binary) still
    // produces a normal JSON error instead of an "attachment" response.
    let started = false;
    dump.stdout.on("data", (chunk) => {
      hash.update(chunk);
      sizeBytes += chunk.length;
      tail = (tail + chunk.toString("latin1")).slice(-4096);
      if (!started) {
        started = true;
        res.setHeader("Content-Type", sink === res ? "application/sql" : "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      }
      // Respect the client's pace so a slow download doesn't buffer the whole
      // dump in server memory.
      if (!sink.write(chunk)) {
        dump.stdout.pause();
        sink.once("drain", () => dump.stdout.resume());
      }
    });

    // The client hung up - stop dumping.
    res.on("close", () => {
      if (!res.writableFinished) dump.kill();
    });

    dump.on("close", (code) => {
      if (code === 0) {
        // Only now is the stream ended: previously stdout was piped straight
        // into the response, which ended it as soon as mysqldump's output
        // finished - before its exit code was known - so a dump that died
        // partway looked like a complete (but truncated, unrestorable) file.
        sink.end();
        resolve({ sizeBytes, sha256: hash.digest("hex"), complete: tail.includes("-- Dump completed") });
      } else {
        reject(new HttpError(500, `mysqldump exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
      }
    });
  });
}

/// Section Admin - Database Restore. The uploaded file (the request body, never held whole in
/// memory) is first written to a temporary file - decrypted on the way if it is an encrypted
/// backup - and checked as it goes: it must open with mysqldump's own header (so an arbitrary
/// file, or a hand-written script, cannot be run through this endpoint), stay within the size
/// limit, and, for an encrypted backup, pass its integrity check to the very last byte. Only then
/// is that file fed to the `mysql` client. A damaged, cut-short or tampered file is therefore
/// turned away before the first statement runs, instead of being applied up to the point where
/// the damage happens to show. The dump's DROP/CREATE TABLE statements replace the existing
/// tables, and DDL isn't transactional, so a failure partway through the restore itself can
/// still leave a partly restored database: the client takes a safety backup first for that reason.
export async function restoreDatabaseFromStream(upload: Request): Promise<void> {
  const file = join(tmpdir(), `ala-eh-restore-${process.pid}-${Date.now()}.sql`);
  try {
    await spoolRestoreUpload(upload, file);
    await runRestore(file);
  } finally {
    await rm(file, { force: true });
  }
}

async function spoolRestoreUpload(upload: Request, file: string): Promise<void> {
  let received = 0;
  let head: Buffer = Buffer.alloc(0);
  let validated = false;
  const check = new Transform({
    transform(chunk: Buffer, _enc, done) {
      received += chunk.length;
      if (received > RESTORE_MAX_BYTES) return done(new HttpError(413, "Backup exceeds the 512 MB restore limit."));
      if (validated) return done(null, chunk);
      head = Buffer.concat([head, chunk]);
      const text = head.subarray(0, 256).toString("utf8").replace(/^\uFEFF/, "");
      if (!isMysqldumpHeader(text)) {
        if (head.length >= 256) return done(HttpError.badRequest("That file isn't a database backup made by this system's Download Backup."));
        return done(); // keep reading until there is enough to judge
      }
      validated = true;
      const held = head;
      head = Buffer.alloc(0);
      done(null, held);
    },
    flush(done) {
      if (received === 0) return done(HttpError.badRequest("No backup file was uploaded."));
      if (!validated) return done(HttpError.badRequest("That file doesn't contain a complete database backup header."));
      done();
    },
  });

  try {
    await pipeline(upload, createBackupDecryptor(env.backupEncryptionKey, { lenient: true }), check, createWriteStream(file), {
      signal: AbortSignal.timeout(RESTORE_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if ((err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError") throw new HttpError(408, "Restore timed out and was stopped.");
    // Anything else at this point is the connection itself: the browser went away mid-upload.
    throw new HttpError(400, "The upload was interrupted - the restore was stopped.");
  }
}

function runRestore(file: string): Promise<void> {
  const { host, port, user, password, database } = parseDatabaseUrl(env.databaseUrl);

  return new Promise((resolve, reject) => {
    const mysql = spawn(env.mysqlPath, ["--host", host, "--port", port, "--user", user, database], {
      env: { ...process.env, MYSQL_PWD: password },
    });

    let stderr = "";
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      mysql.kill();
      // Part of the file may already have run, so nothing cached from before is trustworthy.
      invalidateAll();
      broadcastRealtimeEvent();
      reject(err);
    };
    const timeout = setTimeout(() => fail(new HttpError(408, "Restore timed out and was stopped.")), RESTORE_TIMEOUT_MS);

    mysql.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    mysql.on("error", (err) => {
      fail((err as NodeJS.ErrnoException).code === "ENOENT"
        ? new HttpError(500, "The mysql client isn't installed on this server (or MYSQL_PATH / MYSQLDUMP_PATH is wrong) - install the MySQL client tools to enable database restore.")
        : err);
    });
    mysql.stdin.on("error", () => {});

    const input = createReadStream(file);
    input.on("error", fail);
    input.pipe(mysql.stdin);

    mysql.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      // The tables were replaced (fully, or partly if it failed midway), so
      // nothing cached from before is trustworthy - and open screens need to
      // reload. A restore used to do neither.
      invalidateAll();
      broadcastRealtimeEvent();
      if (code === 0) resolve();
      else reject(new HttpError(500, `Restore failed (mysql exited with code ${code})${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

/// A dump from an older version brings back the older table layout and the
/// older `_prisma_migrations` history, while the running API expects the current
/// layout - so until `prisma migrate deploy` runs (it otherwise only runs when the
/// container starts) queries naming a newer column fail. Run it right after a
/// restore; it only applies the migrations the restored database is missing, and
/// does nothing when the dump was already current.
export function applyPendingMigrations(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["--no-install", "prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: env.databaseUrl },
      // npx is npx.cmd on Windows, which spawn only runs through a shell.
      shell: process.platform === "win32",
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    const timeout = setTimeout(() => child.kill(), RESTORE_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      invalidateAll();
      broadcastRealtimeEvent();
      if (code === 0) resolve();
      else reject(new HttpError(500, `The backup was restored, but updating it to this version failed: ${output.trim().slice(-500)}`));
    });
  });
}

export interface DumpFileSummary {
  /// Size and SHA-256 of the .gz file as written - what is uploaded.
  sizeBytes: number;
  sha256: string;
  /// mysqldump's closing "-- Dump completed" line was seen in the dump itself.
  complete: boolean;
}

/// The same dump as `streamDatabaseBackup`, written gzipped to `filePath`
/// instead of an HTTP response (encrypted when BACKUP_ENCRYPTION_KEY is set; the
/// size and checksum are of the gzip, before encryption) - for the scheduled and "back up now" copies
/// that go to Google Drive. Nothing is buffered whole: dump output flows
/// through gzip to the file. A dump that fails leaves no file behind.
export async function dumpDatabaseToGzipFile(filePath: string): Promise<DumpFileSummary> {
  const { host, port, user, password, database } = parseDatabaseUrl(env.databaseUrl);
  const dump = spawn(env.mysqldumpPath, mysqldumpArgs({ host, port, user, database }), {
    env: { ...process.env, MYSQL_PWD: password },
  });

  let stderr = "";
  dump.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    dump.on("error", (err) =>
      reject(
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new HttpError(500, "mysqldump isn't installed on this server (or MYSQLDUMP_PATH is wrong) - install the MySQL client tools to enable database backups.")
          : err,
      ),
    );
    dump.on("close", resolve);
  });

  let tail = "";
  const watchDump = new Transform({
    transform(chunk, _enc, done) {
      tail = (tail + chunk.toString("latin1")).slice(-4096);
      done(null, chunk);
    },
  });
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const measureOutput = new Transform({
    transform(chunk, _enc, done) {
      hash.update(chunk);
      sizeBytes += chunk.length;
      done(null, chunk);
    },
  });

  try {
    // Both are awaited to the end (allSettled): a missing mysqldump rejects
    // BOTH of them, and a rejection nobody awaits would be an unhandled
    // rejection - which takes this server down. The spawn error is the useful
    // one to report, so it wins over the stream error it causes.
    const [exit, written] = await Promise.allSettled([
      exited,
      pipeline(dump.stdout, watchDump, createGzip(), measureOutput, ...(env.backupEncryptionKey ? [createBackupEncryptor(env.backupEncryptionKey)] : []), createWriteStream(filePath)),
    ]);
    if (exit.status === "rejected") throw exit.reason;
    if (written.status === "rejected") throw written.reason;
    const code = exit.value;
    if (code !== 0) throw new HttpError(500, `mysqldump exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
    return { sizeBytes, sha256: hash.digest("hex"), complete: tail.includes("-- Dump completed") };
  } catch (err) {
    await rm(filePath, { force: true });
    throw err;
  }
}
