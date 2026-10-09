#!/usr/bin/env node
/**
 * Platform dispatcher for the backup/restore scripts.
 *
 * The npm scripts used to invoke `powershell -File scripts/backup.ps1`
 * directly, which made three of them - including `db:migrate:deploy`, which
 * takes a pre-migration snapshot first - fail outright on a Linux VPS. Rather
 * than maintaining two sets of npm script names (and having the wrong one in
 * every deployment doc), this picks the implementation that matches the host:
 * backup.ps1 / restore.ps1 on Windows, backup.sh / restore.sh everywhere else.
 *
 * Arguments are forwarded as-is, so the two implementations keep the same
 * flags: --mode, --label, --file, --latest, --yes.
 *
 * Usage (via package.json):
 *   node scripts/backup.mjs backup  [--mode snapshot] [--label pre-migration]
 *   node scripts/backup.mjs restore [--latest|--file <path>] [--yes]
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const [action, ...args] = process.argv.slice(2);

if (action !== "backup" && action !== "restore") {
  console.error(`Usage: node scripts/backup.mjs <backup|restore> [args...]`);
  process.exit(2);
}

const isWindows = process.platform === "win32";
const script = join(here, isWindows ? `${action}.ps1` : `${action}.sh`);

/**
 * The .sh scripts take GNU-style long flags; the .ps1 scripts take
 * PowerShell parameters. The npm scripts are written once, in the GNU form,
 * and translated here - so `--mode snapshot` reaches backup.ps1 as
 * `-Mode snapshot` and the two implementations stay interchangeable from the
 * caller's point of view.
 *
 * An unmapped `--flag` is passed through as `-flag`, which PowerShell will
 * reject by name if it isn't a real parameter - better than silently
 * dropping it.
 */
const PS_FLAGS = {
  "--mode": "-Mode",
  "--label": "-Label",
  "--backup-dir": "-BackupDir",
  "--retention-days": "-RetentionDays",
  "--keep-snapshots": "-KeepSnapshots",
  "--file": "-File",
  "--yes": "-Force",
  "--no-safety-snapshot": "-SkipSafetySnapshot",
  "--list": "-List",
  // Deliberately NOT mapped: restore.ps1 has no "restore whatever is newest"
  // mode. Passing it through unmapped makes PowerShell reject the parameter
  // by name, which is the right failure for a command that overwrites the
  // database - far better than quietly ignoring the flag and restoring some
  // other file the caller didn't choose.
  // "--latest": (no Windows equivalent - use --file)
};

const translated = isWindows
  ? args.map((a) => (a.startsWith("--") ? (PS_FLAGS[a] ?? `-${a.slice(2)}`) : a))
  : args;

// PowerShell needs -File and an execution-policy bypass (the scripts are not
// signed); bash is invoked explicitly rather than relying on the +x bit,
// which git does not reliably preserve on a Windows checkout that is later
// deployed to Linux.
const [command, commandArgs] = isWindows
  ? ["powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...translated]]
  : ["bash", [script, ...translated]];

// `shell: false` (the default) - arguments are passed as an argv array, so a
// label or path containing spaces or shell metacharacters is never
// reinterpreted by a shell.
const child = spawn(command, commandArgs, { stdio: "inherit" });

child.on("error", (err) => {
  if (err.code === "ENOENT") {
    console.error(
      `Could not run ${command}. ${
        isWindows
          ? "PowerShell is required on Windows."
          : "bash is required - install it, or run the script directly."
      }`,
    );
    process.exit(1);
  }
  throw err;
});

child.on("exit", (code, signal) => {
  // Preserve the real exit code: `db:migrate:deploy` chains on it, and a
  // failed pre-migration snapshot must stop the migration.
  process.exit(signal ? 1 : (code ?? 1));
});
