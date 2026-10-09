import { describe, expect, it } from "vitest";
import type { ImportBatchSummary } from "../api/importBatches";
import { importHistoryCsv } from "./importHistoryCsv";

const batch = (over: Partial<ImportBatchSummary> = {}): ImportBatchSummary => ({
  id: 1,
  location: "ONLINE",
  entryDate: "2026-10-09T00:00:00.000Z",
  shift: "NIGHT",
  fileName: "count.csv",
  rowCount: 12,
  importedAt: "2026-10-09T08:00:00.000Z",
  importedBy: { id: 1, name: "Ana Cruz", username: "ana" },
  ...over,
});

describe("importHistoryCsv", () => {
  it("writes a header and one line per import", () => {
    expect(importHistoryCsv([batch()]).split("\r\n")).toEqual([
      "File,Entry date,Shift,Location,Rows,Imported by,Imported at",
      "count.csv,2026-10-09,Night,ONLINE,12,Ana Cruz,2026-10-09T08:00:00.000Z",
    ]);
  });

  it("quotes commas and tolerates an unknown importer", () => {
    const line = importHistoryCsv([batch({ fileName: "a, b.csv", importedBy: null })]).split("\r\n")[1];
    expect(line).toBe('"a, b.csv",2026-10-09,Night,ONLINE,12,,2026-10-09T08:00:00.000Z');
  });

  it("neutralises formula-looking file names", () => {
    expect(importHistoryCsv([batch({ fileName: "=SUM(A1)" })])).toContain("'=SUM(A1)");
  });

  it("is just the header when nothing was imported", () => {
    expect(importHistoryCsv([])).toBe("File,Entry date,Shift,Location,Rows,Imported by,Imported at");
  });
});
