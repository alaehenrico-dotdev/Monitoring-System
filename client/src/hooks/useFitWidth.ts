import { useEffect, useState } from "react";

/// Whether a table page stretches its columns to fill the pane ("fit") or
/// leaves them as tight as their content (the default). Remembered per page in
/// this browser, the way zoom is, so Audit and Consolidated each keep their own.
export function useFitWidth(key: string) {
  const storageKey = `ala-eh-fit:${key}`;

  const [fit, setFit] = useState<boolean>(() => {
    try {
      return localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, fit ? "1" : "0");
    } catch {
      // Per-viewer convenience only - fine to silently skip if unavailable.
    }
  }, [fit, storageKey]);

  return [fit, setFit] as const;
}
