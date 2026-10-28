import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";

/// Halloween theme only: every few minutes JUMPSCARE.gif fills the whole screen,
/// above everything, for a couple of seconds, then goes away. Rare on purpose -
/// a scare that happens all the time stops being one. Never runs with "reduce
/// motion" on, while the tab is hidden, or in print, and a click, tap or key
/// dismisses it at once.
const MIN_GAP_MS = 2 * 60_000;
const MAX_GAP_MS = 4 * 60_000;
const SHOW_MS = 2_200;
const SRC = "/JUMPSCARE.gif";

function nextGap(): number {
  return MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);
}

export function JumpscareHost() {
  const { uiStyle } = useTheme();
  const active = uiStyle === "halloween";
  // A fresh number per showing, so the <img> remounts and the gif starts from frame one.
  const [showing, setShowing] = useState<number | null>(null);

  useEffect(() => {
    if (!active || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // Decoded ahead of time so the first scare does not arrive late or half-loaded.
    new Image().src = SRC;
    let schedule: number;
    let hide: number;
    const arm = () => {
      schedule = window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          setShowing(Date.now());
          hide = window.setTimeout(() => setShowing(null), SHOW_MS);
        }
        arm();
      }, nextGap());
    };
    arm();
    return () => {
      window.clearTimeout(schedule);
      window.clearTimeout(hide);
      setShowing(null);
    };
  }, [active]);

  useEffect(() => {
    if (showing === null) return;
    const dismiss = () => setShowing(null);
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [showing]);

  if (!active || showing === null) return null;
  return (
    <div className="ae-jumpscare no-print" role="presentation" aria-hidden="true" onClick={() => setShowing(null)}>
      <img key={showing} src={`${SRC}?t=${showing}`} alt="" draggable={false} />
    </div>
  );
}
