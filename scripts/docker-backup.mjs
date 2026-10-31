#!/usr/bin/env node
/* eslint-disable no-console -- a command-line tool: its output is the console */
// Backup and restore for the DOCKER database (docker-compose.yml's `db` service).
//
// scripts/backup.* dump the database named in server/.env, which is a MySQL on the
// host; the Docker database is a different one, kept in the `db_data` volume. This
// dumps that one, with no password needed on the command line: the container
// already has its own root password.
//
//   node scripts/docker-backup.mjs backup
//   node scripts/docker-backup.mjs restore --file <path.sql.gz> --yes
//   node scripts/docker-backup.mjs restore --file <path.sql.gz> --yes --database scratch_check
//
// Backups go to DOCKER_BACKUP_DIR (default C:\ala-eh-backups\docker, or
// /var/backups/alaeh-stocks/docker) - outside the repo and outside the Docker volume, so
// `docker compose down -v` or a deleted volume cannot take them with it. The
// newest DOCKER_BACKUP_KEEP (default 30) are kept.
//
// `restore` REPLACES the target database, so it needs --yes, and (for the app's own
// database) takes a safety backup first. Restoring into --database <other name>
// leaves the app's data alone - the way to check a backup actually loads.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DB = "ala_eh_stocks";
const DIR = process.env.DOCKER_BACKUP_DIR || (process.platform === "win32" ? "C:\\ala-eh-backups\\docker" : "/var/backups/alaeh-stocks/docker");
const KEEP = Number(process.env.DOCKER_BACKUP_KEEP || 30);
const IN_CONTAINER = "/tmp/ala-eh-transfer.sql.gz";

function run(args, opts = {}) {
  const r = spawnSync("docker", ["compose", ...args], { cwd: ROOT, encoding: "utf8", ...opts });
  if (r.status !== 0) throw new Error(`docker compose ${args.slice(0, 3).join(" ")} failed: ${(r.stderr || r.stdout || "").trim()}`);
  return (r.stdout || "").trim();
}

// Runs a shell snippet in the db container, with the root password from its own environment.
const inDb = (script) => run(["exec", "-T", "db", "sh", "-c", script]);

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
}

function backup(label = "") {
  inDb("mysqladmin ping -h 127.0.0.1 -uroot -p\"$MYSQL_ROOT_PASSWORD\" --silent");
  mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `docker_db_backup_${stamp()}${label ? `_${label}` : ""}.sql.gz`);
  const bytes = Number(
    inDb(
      `MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --triggers --no-tablespaces ${APP_DB} | gzip > ${IN_CONTAINER} && gzip -t ${IN_CONTAINER} && wc -c < ${IN_CONTAINER}`,
    ),
  );
  run(["cp", `db:${IN_CONTAINER}`, file]);
  inDb(`rm -f ${IN_CONTAINER}`);
  const onDisk = statSync(file).size;
  if (!(bytes > 1024) || onDisk !== bytes) {
    rmSync(file, { force: true });
    throw new Error(`Backup looks wrong (container ${bytes} bytes, copied ${onDisk}); it was not kept.`);
  }
  const all = readdirSync(DIR)
    .filter((n) => n.startsWith("docker_db_backup_") && n.endsWith(".sql.gz"))
    .sort()
    .reverse();
  for (const old of all.slice(KEEP)) rmSync(path.join(DIR, old), { force: true });
  console.log(`Backup OK: ${file} (${onDisk} bytes, verified)`);
  return file;
}

function restore(file, database, confirmed) {
  if (!file || !existsSync(file)) throw new Error("Give an existing backup with --file <path.sql.gz>.");
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error("--database may only contain letters, digits and underscores.");
  if (!confirmed) throw new Error(`This replaces the contents of "${database}". Run again with --yes to go ahead.`);
  if (database === APP_DB) backup("pre-restore");
  run(["cp", file, `db:${IN_CONTAINER}`]);
  try {
    inDb(`gzip -t ${IN_CONTAINER}`);
    inDb(
      `MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "DROP DATABASE IF EXISTS ${database}; CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" && gunzip -c ${IN_CONTAINER} | MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot ${database}`,
    );
  } finally {
    inDb(`rm -f ${IN_CONTAINER}`);
  }
  const users = inDb(`MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -e "SELECT COUNT(*) FROM ${database}.users"`);
  console.log(`Restore OK into "${database}" (${users} user rows found).`);
  if (database === APP_DB) console.log("Restart the API so it picks the data up cleanly: docker compose restart api");
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
try {
  if (cmd === "backup") backup();
  else if (cmd === "restore") restore(flag("--file"), flag("--database") || APP_DB, rest.includes("--yes"));
  else {
    console.log("Usage: node scripts/docker-backup.mjs backup | restore --file <path.sql.gz> --yes [--database <name>]");
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
