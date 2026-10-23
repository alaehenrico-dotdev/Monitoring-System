import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getExtraLabels, saveExtraLabel, type ExtraLabelLocation } from "../api/extraLabels";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { useResetOnKeyChange } from "./useResetOnKeyChange";
import type { Shift } from "../types";
import { extraColumnKey, parseExtraColumnKey } from "./useExtraColumns";
import { isWholeDayMode } from "../utils/shift";

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
    // Whole-day mode shows a day entered by shift as one sheet (the Night
    // sheet), so the names typed on its Morning sheet are read too - they only
    // fill slots the Night sheet left unnamed and are never written back.
    const morningNames =
      isWholeDayMode() && shift === "NIGHT"
        ? getExtraLabels(location, date, "MORNING").catch(() => [] as Awaited<ReturnType<typeof getExtraLabels>>)
        : Promise.resolve([] as Awaited<ReturnType<typeof getExtraLabels>>);
    Promise.all([getExtraLabels(location, date, shift), morningNames])
      .then(([rows, morningRows]) => {
        if (!current) return;
        const fromServer: Record<string, string> = {};
        for (const r of rows) fromServer[extraColumnKey(r.columnKey, r.slotIndex)] = r.label;
        saved.current = fromServer;
        const shown = { ...fromServer };
        for (const r of morningRows) {
          const key = extraColumnKey(r.columnKey, r.slotIndex);
          if (!shown[key]) shown[key] = r.label;
        }
        // Keep a name that is being typed right now over the refetched one.
        setNames((prev) => {
          const next = { ...shown };
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

  /// Saves every name typed but not yet committed. A name is committed when its
  /// input loses focus; this covers a Save (Ctrl+S, or a click that never moved
  /// focus) while the cursor is still in a header, so no typed name is left
  /// behind. Resolves once every save has settled.
  const flush = useCallback(async () => {
    for (const key of Object.keys(live.current)) {
      const parsed = parseExtraColumnKey(key);
      if (!parsed) continue;
      const value = (live.current[key] ?? "").trim().replace(/\s+/g, " ");
      if (value === (saved.current[key] ?? "")) continue;
      try {
        await saveExtraLabel({ location, date, shift, columnKey: parsed.mainKey, slotIndex: parsed.slot, label: value });
        if (value) saved.current[key] = value;
        else delete saved.current[key];
      } catch (e) {
        onError(e instanceof Error ? e.message : "Could not save the column name");
      }
    }
  }, [location, date, shift, onError]);

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

  return { names, change, commit, clear, flush };
}
