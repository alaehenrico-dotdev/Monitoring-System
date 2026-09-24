import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/// A drop-in `useState` whose value also lives in sessionStorage under
/// `key`, so it survives the page unmounting - i.e. switching to another tab
/// (route) and back - the same way Online/Offline Entry keep their staged
/// edits (see usePendingEntryChanges). sessionStorage rather than
/// localStorage on purpose: it's in-progress work for this browser session,
/// not a durable preference, so closing the tab still discards it.
///
/// The key is removed again whenever the value equals its initial value, so
/// (a) an untouched form leaves nothing behind and (b) a default that
/// depends on "today" is never frozen: only a value the user actually
/// changed is restored next time, everything else recomputes fresh.
///
/// Best effort, like the rest of the pending-edit storage - private windows
/// or blocked site data just mean nothing is restored, never that editing
/// breaks. `T` must be JSON-serializable.
export function useSessionState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [initialValue] = useState<T>(() => (typeof initial === "function" ? (initial as () => T)() : initial));

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      // fall through to the initial value
    }
    return initialValue;
  });

  useEffect(() => {
    try {
      const serialized = JSON.stringify(value);
      if (serialized === JSON.stringify(initialValue)) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, serialized);
    } catch {
      // Best effort.
    }
  }, [key, value, initialValue]);

  return [value, setValue];
}
