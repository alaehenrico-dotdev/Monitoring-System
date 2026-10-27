import { useCallback, useEffect, useState } from "react";

/// Whether a report page leaves out products with no figures (`rows`) and columns
/// that are empty for every product (`columns`). Both start OFF, so the report
/// lists everything until someone chooses otherwise, and are remembered per page
/// in this browser, like zoom and fit-to-width.
export function useHideEmpty(key: string) {
  const read = (name: string) => {
    try {
      return localStorage.getItem(`ala-eh-hide-empty-${name}:${key}`) === "1";
    } catch {
      return false;
    }
  };
  const [rows, setRows] = useState<boolean>(() => read("rows"));
  const [columns, setColumns] = useState<boolean>(() => read("columns"));

  useEffect(() => {
    try {
      localStorage.setItem(`ala-eh-hide-empty-rows:${key}`, rows ? "1" : "0");
      localStorage.setItem(`ala-eh-hide-empty-columns:${key}`, columns ? "1" : "0");
    } catch {
      // Per-viewer convenience only - fine to silently skip if unavailable.
    }
  }, [rows, columns, key]);

  const toggleRows = useCallback(() => setRows((v) => !v), []);
  const toggleColumns = useCallback(() => setColumns((v) => !v), []);
  return { rows, columns, toggleRows, toggleColumns };
}
