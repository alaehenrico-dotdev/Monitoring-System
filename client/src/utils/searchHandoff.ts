/**
 * One-shot hand-offs from the phone's search (components/QuickJump.tsx) to the page a result
 * opens: "show Settings on the Backup tab", "filter Consolidated to this SKU", "open the Daily
 * Report for Nov 9". Same idea as utils/quickJumpTarget.ts, for values other than a product row.
 *
 * Module scope rather than the address bar: these pages keep their filters in component state
 * and several are rendered (and tested) without a router, so a query string would have to be
 * threaded through each one. A page reads its key when it mounts and whenever a new request
 * arrives while it is already open (hooks/useSearchHandoff.ts); the value is cleared as it is
 * read, and an unclaimed one expires, so it can never replay on a later visit.
 */

export type HandoffKey = "settings-tab" | "stocks-query" | "stocks-category" | "changelog-query" | "report-date";

/// Long enough for a lazily loaded page to mount on a slow connection.
const HANDOFF_TTL_MS = 15_000;

const pending = new Map<HandoffKey, { value: string; at: number }>();
const listeners = new Set<() => void>();

export function handOff(key: HandoffKey, value: string): void {
  pending.set(key, { value, at: Date.now() });
  for (const l of listeners) l();
}

/// The pending value for `key`, removed as it is returned; null if none (or it expired).
export function takeHandoff(key: HandoffKey): string | null {
  const hit = pending.get(key);
  if (!hit) return null;
  pending.delete(key);
  return Date.now() - hit.at > HANDOFF_TTL_MS ? null : hit.value;
}

/// Subscribe to new hand-offs. Returns the unsubscribe, for a `useEffect`.
export function subscribeHandoff(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/// For tests.
export function clearHandoffs(): void {
  pending.clear();
}
