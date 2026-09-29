import { useState } from "react";

/**
 * Runs `onKeyChange` the instant `key` differs from what it was on the
 * previous render - e.g. resetting `rows` to `null` (so a loading skeleton
 * shows) the moment date/shift/filter changes, before the effect that
 * re-fetches for the new key even runs. This is React's "adjusting state
 * when a prop changes" pattern (done during render, not in an effect):
 * calling setState synchronously inside an effect body triggers an extra,
 * avoidable render pass and trips the react-hooks/set-state-in-effect rule,
 * while doing it here bails out before the browser ever paints the stale
 * frame.
 */
export function useResetOnKeyChange(key: string, onKeyChange: () => void) {
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    onKeyChange();
  }
}
