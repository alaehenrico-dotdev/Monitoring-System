import { describe, expect, it } from "vitest";
import { isMysqldumpHeader } from "./dumpHeader";

describe("isMysqldumpHeader", () => {
  it("accepts a MySQL or MariaDB dump header", () => {
    expect(isMysqldumpHeader("-- MySQL dump 10.13  Distrib 8.0.36, for Linux (x86_64)\n--\n")).toBe(true);
    expect(isMysqldumpHeader("-- MariaDB dump 10.19  Distrib 10.11.18-MariaDB\n")).toBe(true);
    expect(isMysqldumpHeader("\uFEFF-- MySQL dump 10.13\n")).toBe(true);
  });

  it("accepts MariaDB's sandbox-mode line in front of the header (what the Docker image's mysqldump writes)", () => {
    const real = "/*M!999999\\- enable the sandbox mode */ \n-- MariaDB dump 10.19  Distrib 10.11.18-MariaDB, for debian-linux-gnu (x86_64)\n--\n";
    expect(isMysqldumpHeader(real)).toBe(true);
    expect(isMysqldumpHeader(real.replace(/\n/g, "\r\n"))).toBe(true);
  });

  it("still refuses anything else, including other text ahead of the header", () => {
    expect(isMysqldumpHeader("SELECT 1;\n")).toBe(false);
    expect(isMysqldumpHeader("")).toBe(false);
    expect(isMysqldumpHeader("DROP DATABASE x;\n-- MySQL dump 10.13\n")).toBe(false);
    expect(isMysqldumpHeader("/*M!999999\\- enable the sandbox mode */\nDROP TABLE users;\n-- MySQL dump\n")).toBe(false);
    expect(isMysqldumpHeader("/*!40101 SET @x=1 */;\n-- MySQL dump 10.13\n")).toBe(false);
  });
});
