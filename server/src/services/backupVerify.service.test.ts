import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ backupRecord: { findFirst: vi.fn() } }));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));

import { buildReport, inspectDump, REQUIRED_TABLES } from "./backupVerify.service";

const dump = (opts: { header?: boolean; trailer?: boolean; tables?: string[] } = {}) => {
  const { header = true, trailer = true, tables = REQUIRED_TABLES } = opts;
  return [
    header ? "-- MySQL dump 10.13  Distrib 8.0.36\n" : "SELECT 1;\n",
    ...tables.map((t) => `DROP TABLE IF EXISTS \`${t}\`;\nCREATE TABLE \`${t}\` (id int);\n`),
    trailer ? "-- Dump completed on 2026-10-13 09:00:00\n" : "",
  ].join("");
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.backupRecord.findFirst.mockResolvedValue(null);
});

describe("inspectDump + buildReport", () => {
  it("passes a complete dump with every core table", async () => {
    const report = await buildReport(await inspectDump(Readable.from([dump()])));
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("passes the dump the Docker image's MariaDB mysqldump writes (a sandbox-mode comment comes first)", async () => {
    const sandbox = "/*M!999999\\- enable the sandbox mode */ \n";
    const text = sandbox + "-- MariaDB dump 10.19  Distrib 10.11.18-MariaDB, for debian-linux-gnu (x86_64)\n" + dump().split("\n").slice(1).join("\n");
    const report = await buildReport(await inspectDump(Readable.from([text])));
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
  });

  it("flags a dump cut short (no closing line)", async () => {
    const report = await buildReport(await inspectDump(Readable.from([dump({ trailer: false })])));
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/incomplete/);
  });

  it("flags a file that is not a mysqldump", async () => {
    const report = await buildReport(await inspectDump(Readable.from([dump({ header: false })])));
    expect(report.ok).toBe(false);
    expect(report.problems[0]).toMatch(/isn't a mysqldump/);
  });

  it("flags missing core tables, and finds a table name split across chunks", async () => {
    const text = dump({ tables: REQUIRED_TABLES.filter((t) => t !== "change_log") });
    const mid = text.indexOf("daily_online_stock") + 5;
    const report = await buildReport(await inspectDump(Readable.from([text.slice(0, mid), text.slice(mid)])));
    expect(report.missingTables).toEqual(["change_log"]);
    expect(report.tableCount).toBe(REQUIRED_TABLES.length - 1);
  });

  it("flags an empty file", async () => {
    const report = await buildReport(await inspectDump(Readable.from([])));
    expect(report.ok).toBe(false);
    expect(report.problems[0]).toMatch(/empty/);
  });

  it("refuses a file over the size limit", async () => {
    await expect(inspectDump(Readable.from(["x".repeat(100)]), 10)).rejects.toMatchObject({ status: 413 });
  });

  it("warns (without failing) when the checksum is not one this system recorded", async () => {
    const report = await buildReport(await inspectDump(Readable.from([dump()])));
    expect(report.ok).toBe(true);
    expect(report.warnings).toHaveLength(1);
    expect(report.known).toBeNull();
  });
});
