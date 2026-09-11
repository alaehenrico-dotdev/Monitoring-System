/**
 * Minimal in-memory TTL cache. This is a single-process Express app talking
 * to one MySQL instance (no horizontal scaling, no Redis in the stack), so a
 * process-local Map is the right amount of caching machinery here - anything
 * more would be solving a scaling problem this app doesn't have yet.
 *
 * Intended for read-heavy, rarely-written data (the product master list is
 * the case in this app: read on almost every grid/report/receipt-form load,
 * written only when an admin adds/edits/deactivates a SKU). Callers must
 * invalidate the relevant key(s) on write - see productRepository.ts.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export async function getOrSet<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const value = await fetcher();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export function invalidate(key: string) {
  store.delete(key);
}

export function invalidatePrefix(prefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
