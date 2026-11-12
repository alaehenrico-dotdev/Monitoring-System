import { useEffect, useRef } from "react";
import { subscribeHandoff, takeHandoff, type HandoffKey } from "../utils/searchHandoff";

/// Applies a value the phone's search handed to this page (utils/searchHandoff.ts): once when
/// the page mounts, and again if a new one arrives while it is open. `apply` is usually a state
/// setter; it may change between renders without re-subscribing.
export function useSearchHandoff(key: HandoffKey, apply: (value: string) => void): void {
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  });
  useEffect(() => {
    const run = () => {
      const value = takeHandoff(key);
      if (value !== null) applyRef.current(value);
    };
    run();
    return subscribeHandoff(run);
  }, [key]);
}
