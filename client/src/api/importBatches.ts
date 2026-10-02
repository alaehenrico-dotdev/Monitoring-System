import { http } from "./http";
import type { Shift, StockLocation } from "../types";

/// Import History (Section: CSV import into Manual Count - see CsvTools.tsx).
export interface ImportBatchSummary {
  id: number;
  location: StockLocation;
  entryDate: string;
  shift: Shift;
  fileName: string;
  rowCount: number;
  importedAt: string;
  importedBy: { id: number; name: string; username: string } | null;
}

export function createImportBatch(data: { location: StockLocation; date: string; shift: Shift; fileName: string }) {
  return http.post<{ id: number }>("/import-batches", data);
}

export function finalizeImportBatch(id: number, rowCount: number) {
  return http.patch<void>(`/import-batches/${id}`, { rowCount });
}

export function listImportBatches(location?: StockLocation) {
  return http.get<ImportBatchSummary[]>(`/import-batches${location ? `?location=${location}` : ""}`);
}

/// Reverts exactly the cells this import changed (skipping any touched again
/// since - see the server's revertImportBatch) and then removes the entry.
export function deleteImportBatch(id: number) {
  return http.delete<{ reverted: number; skipped: number }>(`/import-batches/${id}`);
}
