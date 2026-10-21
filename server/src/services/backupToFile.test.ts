import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { gunzipSync } from "zlib";
import { createHash } from "crypto";

vi.mock("child_process", () => ({ spawn: vi.fn() }));
vi.mock("../config/env", () => ({
  env: { databaseUrl: "mysql://app:s3cret@db:3306/ala_eh", mysqldumpPath: "mysqldump", mysqlPath: "mysql" },
}));

import { spawn } from "child_process";
import { dumpDatabaseToGzipFile } from "./backup.service";

class FakeDump extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
}

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dump-test-"));
  file = join(dir, "backup.sql.gz");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function fakeRun(output: string, exitCode: number, stderr = "") {
  const proc = new FakeDump();
  vi.mocked(spawn).mockReturnValue(proc as never);
  setImmediate(() => {
    proc.stderr.write(stderr);
    proc.stdout.end(output);
    setImmediate(() => proc.emit("close", exitCode));
  });
  return proc;
}

describe("dumpDatabaseToGzipFile", () => {
  it("writes the dump gzipped, and reports the size and hash of the file it wrote", async () => {
    fakeRun("-- MySQL dump\nCREATE TABLE t (id int);\n-- Dump completed on 2026-10-22\n", 0);
    const summary = await dumpDatabaseToGzipFile(file);
    const written = readFileSync(file);
    expect(gunzipSync(written).toString()).toContain("CREATE TABLE t");
    expect(summary.sizeBytes).toBe(written.length);
    expect(summary.sha256).toBe(createHash("sha256").update(written).digest("hex"));
    expect(summary.complete).toBe(true);
  });

  it("says when the dump is missing its closing line, so a truncated one is not trusted", async () => {
    fakeRun("-- MySQL dump\nCREATE TABLE t (id int);\n", 0);
    expect((await dumpDatabaseToGzipFile(file)).complete).toBe(false);
  });

  it("passes the password in the environment, never on the command line", async () => {
    fakeRun("-- Dump completed", 0);
    await dumpDatabaseToGzipFile(file);
    const [, args, options] = vi.mocked(spawn).mock.calls[0];
    expect(args).not.toContain("s3cret");
    expect(args.join(" ")).not.toMatch(/password/i);
    expect((options as { env: Record<string, string> }).env.MYSQL_PWD).toBe("s3cret");
  });

  it("leaves no file behind when mysqldump fails, and says why", async () => {
    fakeRun("partial", 2, "Access denied for user");
    await expect(dumpDatabaseToGzipFile(file)).rejects.toThrow(/exited with code 2.*Access denied/);
    expect(existsSync(file)).toBe(false);
  });

  it("explains a missing mysqldump instead of crashing on the stream error it causes", async () => {
    const proc = new FakeDump();
    vi.mocked(spawn).mockReturnValue(proc as never);
    setImmediate(() => {
      proc.emit("error", Object.assign(new Error("spawn mysqldump ENOENT"), { code: "ENOENT" }));
      proc.stdout.destroy(new Error("premature close"));
    });
    await expect(dumpDatabaseToGzipFile(file)).rejects.toThrow(/mysqldump isn't installed/);
    expect(existsSync(file)).toBe(false);
  });
});
