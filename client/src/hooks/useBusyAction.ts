import { useCallback, useRef, useState } from "react";

/**
 * Runs one async user action at a time and reports whether it is in flight.
 *
 * `busy` drives the visible state (a Button's `loading`); the ref is what
 * actually stops a second click, because `busy` only updates on the next
 * render - two clicks in the same tick would both pass a `disabled` check.
 * A call made while one is running is ignored (resolves to undefined), and the
 * busy flag always clears, whether the action resolves or throws.
 */
export function useBusyAction() {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    try {
      return await action();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, run };
}
