import { spawn } from "child_process";
import type { Request, Response } from "express";
import { env } from "../config/env";
import { HttpError } from "../utils/HttpError";

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

/// Section Admin - Database Backup. Streams a full `mysqldump` of the app's
/// database straight to the HTTP response so a SUPERVISOR_ADMIN can pull an
/// offline copy from the browser, with no shell access to the DB server
/// required. The password goes in via MYSQL_PWD (an env var only this child
/// process sees) rather than a --password flag, which would otherwise be
/// visible to anyone who can list processes on the host. Requires the MySQL
/// client tools (`mysqldump`) to be installed on whatever machine runs this
/// server - that's a deploy-time dependency, not something this app can
/// install for itself.
export function streamDatabaseBackup(res: Response, filename: string): Promise<void> {
  const { host, port, user, password, database } = parseDatabaseUrl(env.databaseUrl);

  return new Promise((resolve, reject) => {
    const dump = spawn(
      env.mysqldumpPath,
      [
        "--host", host, "--port", port, "--user", user,
        "--single-transaction", "--routines", "--triggers",
        // MySQL 8 otherwise demands the server-wide PROCESS privilege just to
        // dump tablespace metadata, which an app-level DB user rarely has.
        "--no-tablespaces",
        database,
      ],
      { env: { ...process.env, MYSQL_PWD: password } },
    );

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
      if (!started) {
        started = true;
        res.setHeader("Content-Type", "application/sql");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      }
      // Respect the client's pace so a slow download doesn't buffer the whole
      // dump in server memory.
      if (!res.write(chunk)) {
        dump.stdout.pause();
        res.once("drain", () => dump.stdout.resume());
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
        res.end();
        resolve();
      } else {
        reject(new HttpError(500, `mysqldump exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
      }
    });
  });
}

/// Section Admin - Database Restore. Streams an uploaded `mysqldump` file
/// (the request body itself, never buffered whole) into the `mysql` client.
/// The file must open with mysqldump's own header - checked on the first
/// chunk, before anything is sent to MySQL - so an arbitrary file (or a
/// hand-written script) can't be run through this endpoint. The dump's
/// DROP/CREATE TABLE statements replace the existing tables, and DDL isn't
/// transactional, so a failure partway can leave a partly restored database:
/// the client takes a safety backup first for that reason.
export function restoreDatabaseFromStream(req: Request): Promise<void> {
  const { host, port, user, password, database } = parseDatabaseUrl(env.databaseUrl);

  return new Promise((resolve, reject) => {
    const mysql = spawn(env.mysqlPath, ["--host", host, "--port", port, "--user", user, database], {
      env: { ...process.env, MYSQL_PWD: password },
    });

    let stderr = "";
    let settled = false;
    let received = 0;
    let checked = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      mysql.kill();
      reject(err);
    };

    mysql.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    mysql.on("error", (err) => {
      fail(
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new HttpError(500, "The mysql client isn't installed on this server (or MYSQL_PATH / MYSQLDUMP_PATH is wrong) - install the MySQL client tools to enable database restore.")
          : err,
      );
    });
    // Broken pipe when mysql exits early on an SQL error - reported via "close" below.
    mysql.stdin.on("error", () => {});

    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      received += chunk.length;
      if (!checked) {
        if (!/^-- (MySQL|MariaDB) dump/.test(chunk.subarray(0, 200).toString("utf8").replace(/^﻿/, ""))) {
          fail(HttpError.badRequest("That file isn't a database backup made by this system's Download Backup."));
          return;
        }
        checked = true;
      }
      if (!mysql.stdin.write(chunk)) {
        req.pause();
        mysql.stdin.once("drain", () => req.resume());
      }
    });
    req.on("end", () => {
      if (settled) return;
      if (received === 0) fail(HttpError.badRequest("No backup file was uploaded."));
      else mysql.stdin.end();
    });
    req.on("error", fail);
    // Upload dropped mid-way: a truncated dump would leave a half-restored
    // database, so stop immediately rather than letting mysql "finish".
    req.on("aborted", () => fail(new HttpError(400, "The upload was interrupted - the restore was stopped.")));

    mysql.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else reject(new HttpError(500, `Restore failed (mysql exited with code ${code})${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}
