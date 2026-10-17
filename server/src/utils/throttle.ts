/// A gate that opens at most once per `intervalMs`: `allow()` is true the first
/// time and then false until the interval has passed. For things that repeat on a
/// timer outside our control (a monitor polling /health every few seconds) and
/// should be logged once per outage, not once per poll. `now` is injectable so
/// the behavior can be tested without waiting.
export function makeThrottle(intervalMs: number, now: () => number = Date.now) {
  let last = Number.NEGATIVE_INFINITY;
  return {
    allow(): boolean {
      const t = now();
      if (t - last < intervalMs) return false;
      last = t;
      return true;
    },
  };
}
