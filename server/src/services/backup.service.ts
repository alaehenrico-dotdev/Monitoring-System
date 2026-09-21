import { spawn } from "child_process";
import type { Response } from "express";
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
export function streamDatabaseBackup(res: Response): Promise<void> {
  const { host, port, user, password, database } = parseDatabaseUrl(env.databaseUrl);

  return new Promise((resolve, reject) => {
    const dump = spawn(
      "mysqldump",
      ["--host", host, "--port", port, "--user", user, "--single-transaction", "--routines", "--triggers", database],
      { env: { ...process.env, MYSQL_PWD: password } },
    );

    let stderr = "";
    dump.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    dump.on("error", (err) => {
      reject(
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new HttpError(500, "mysqldump isn't installed on this server - install the MySQL client tools to enable database backups.")
          : err,
      );
    });

    dump.stdout.pipe(res);

    dump.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new HttpError(500, `mysqldump exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}
