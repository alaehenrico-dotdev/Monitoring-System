import { useEffect, useRef, useState } from "react";

const COUNT_UP_DURATION_MS = 700;

// Animates a displayed number from its previous value up (or down) to
// `target` whenever `target` changes, instead of the digits just snapping
// in - used by the stat cards so the headline numbers count up on first load
// and re-count if a value changes underneath them.
//
// `prevRef` (not `useState`) holds the animation's start point: it has to
// survive across renders without triggering one. It is updated on every
// frame, so if `target` changes mid-animation the next count starts from
// what's on screen rather than jumping back to the last finished value.
//
// `target === undefined` (data hasn't loaded yet) leaves the displayed value
// alone - the cards render "—" for that case instead.
export function useCountUp(
  target: number | undefined,
  duration = COUNT_UP_DURATION_MS,
) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  // Respect the OS "reduce motion" setting: show the number immediately,
  // the instant `target` changes - done during render (not the animation
  // effect below) since there's no animation to run in that case at all.
  const [snappedTo, setSnappedTo] = useState<number | undefined>(undefined);
  if (reducedMotion && target !== undefined && target !== snappedTo) {
    setSnappedTo(target);
    setDisplay(target);
  }
  // Refs can't be written during render itself (only state can) - keeping
  // prevRef in sync with a just-snapped value happens here instead, so a
  // later animation (reduced-motion turned back off, or target changes
  // again) still starts from what's actually on screen.
  useEffect(() => {
    if (snappedTo !== undefined) prevRef.current = snappedTo;
  }, [snappedTo]);

  useEffect(() => {
    if (target === undefined || reducedMotion) return;
    const targetValue = target;
    const start = prevRef.current;
    const delta = targetValue - start;
    if (delta === 0) return;

    const startTime = performance.now();
    let frame: number;

    function tick(now: number) {
      // Clamped at BOTH ends: a frame's timestamp can precede the start time
      // taken in the effect (the frame began before the effect ran), and a
      // negative progress would push the easing curve - and the figure on
      // screen - below its start for a frame.
      const progress = Math.min(Math.max((now - startTime) / duration, 0), 1);
      // Ease-out cubic: fast at the start, settles gently into the final number.
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(start + delta * eased);
      prevRef.current = value;
      setDisplay(value);

      if (progress < 1) frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reducedMotion]);

  return display;
}
