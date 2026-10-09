/**
 * A one-shot "jump to this product" request, handed from the Ctrl+K palette
 * to whichever StockGrid mounts next.
 *
 * It can't just be a prop or a route param: selecting a product navigates to
 * a lazily-loaded page whose rows then arrive over the network, so the grid
 * that has to act on the request doesn't exist yet when the request is made,
 * and still has no rows for a beat after it mounts. So the target parks here
 * until a grid that actually contains that product picks it up (`consume`),
 * rather than being delivered once and lost.
 *
 * Module scope, not sessionStorage: this is a single in-flight gesture, not
 * state worth surviving a reload - a stale "jump to product 12" replaying on
 * next launch would be a small mystery, not a feature. TTL below covers the
 * case where the product simply isn't on the page that was opened.
 */

/// Long enough for a lazy chunk plus the grid's own fetch on a slow
/// connection; short enough that an unclaimed request can't surprise a grid
/// the user navigates to minutes later under their own steam.
const TARGET_TTL_MS = 15_000;

interface Target {
  productId: number;
  at: number;
}

let target: Target | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function requestQuickJump(productId: number): void {
  target = { productId, at: Date.now() };
  notify();
}

/// Subscribe to new requests. Returns the unsubscribe, so it drops straight
/// into a `useEffect`.
export function subscribeQuickJump(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/// The pending product id, or null if there is none (or it has expired).
export function peekQuickJump(): number | null {
  if (!target) return null;
  if (Date.now() - target.at > TARGET_TTL_MS) {
    target = null;
    return null;
  }
  return target.productId;
}

/**
 * Claims the pending request. Callers pass `has` so a grid only takes a
 * target it can actually satisfy - on a page showing one channel's products,
 * or mid-load with no rows yet, an unmatched request stays pending for the
 * grid that can honour it instead of being swallowed here.
 */
export function consumeQuickJump(has: (productId: number) => boolean): number | null {
  const productId = peekQuickJump();
  if (productId === null || !has(productId)) return null;
  target = null;
  return productId;
}

/// Test seam - drops any pending request without consuming it.
export function clearQuickJump(): void {
  target = null;
}
