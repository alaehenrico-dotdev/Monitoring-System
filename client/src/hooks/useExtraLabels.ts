import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getExtraLabels, saveExtraLabel, type ExtraLabelLocation } from "../api/extraLabels";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { useResetOnKeyChange } from "./useResetOnKeyChange";
import type { Shift } from "../types";
import { extraColumnKey, parseExtraColumnKey } from "./useExtraColumns";

/**
 * The names typed into added ("+1") column headers, saved on the server per
 * sheet (location + date + shift) so they are the same on every PC and are
 * recorded in the Change Log. Typing updates the header at once; the name is
 * saved when the input loses focus (`commit`). A save that fails puts the
 * last saved name back and reports why through `onError`.
 */
export function useExtraLabels(
  location: ExtraLabelLocation,
  date: string,
  shift: Shift,
  onError: (message: string) => void,
) {
  const [names, setNames] = useState<Record<string, string>>({});
  // What the server holds, so a blur with no change sends nothing and a failed
  // save can be rolled back.
  const saved = useRef<Record<string, string>>({});
  const live = useRef(names);
  useLayoutEffect(() => {
    live.current = names;
  });
  const realtimeVersion = useRealtimeVersion();

  useEffect(() => {
    let current = true;
    getExtraLabels(location, date, shift)
      .then((rows) => {
        if (!current) return;
        const fromServer: Record<string, string> = {};
        for (const r of rows) fromServer[extraColumnKey(r.columnKey, r.slotIndex)] = r.label;
        saved.current = fromServer;
        // Keep a name that is being typed right now over the refetched one.
        setNames((prev) => {
          const next = { ...fromServer };
          for (const [k, v] of Object.entries(prev)) if (v !== (saved.current[k] ?? "")) next[k] = v;
          return next;
        });
      })
      .catch(() => {
        // Names are cosmetic: the grid still works without them.
      });
    return () => {
      current = false;
      // What the server held for the sheet being left must not leak into the next.
      saved.current = {};
    };
  }, [location, date, shift, realtimeVersion]);

  // A different sheet starts from its own names.
  useResetOnKeyChange(`${location}:${date}:${shift}`, () => setNames({}));

  const change = useCallback((key: string, value: string) => {
    setNames((n) => ({ ...n, [key]: value }));
  }, []);

  const commit = useCallback(
    (key: string) => {
      const parsed = parseExtraColumnKey(key);
      if (!parsed) return;
      const value = (live.current[key] ?? "").trim().replace(/\s+/g, " ");
      if (value === (saved.current[key] ?? "")) return;
      saveExtraLabel({ location, date, shift, columnKey: parsed.mainKey, slotIndex: parsed.slot, label: value })
        .then(() => {
          if (value) saved.current[key] = value;
          else delete saved.current[key];
          setNames((n) => (n[key] === value ? n : { ...n, [key]: value }));
        })
        .catch((e: unknown) => {
          const back = saved.current[key] ?? "";
          setNames((n) => ({ ...n, [key]: back }));
          onError(e instanceof Error ? e.message : "Could not save the column name");
        });
    },
    [location, date, shift, onError],
  );

  /// The column was deleted: its name goes with it, so a column added later in
  /// the same slot does not inherit it.
  const clear = useCallback(
    (key: string) => {
      setNames(({ [key]: _gone, ...rest }) => rest);
      const parsed = parseExtraColumnKey(key);
      if (!parsed || !(key in saved.current)) return;
      saveExtraLabel({ location, date, shift, columnKey: parsed.mainKey, slotIndex: parsed.slot, label: "" })
        .then(() => {
          delete saved.current[key];
        })
        .catch((e: unknown) => onError(e instanceof Error ? e.message : "Could not clear the column name"));
    },
    [location, date, shift, onError],
  );

  return { names, change, commit, clear };
}
