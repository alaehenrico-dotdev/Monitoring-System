import { useEffect } from "react";
import { useActivity, type ActivityState } from "../utils/activity";
import { useReadOnlyPhone } from "./useReadOnlyPhone";

/// The tab icon mirrors the header beam: while the system is saving, loading or
/// reconnecting, a bright arc orbits the icon's rim; at rest it is the plain
/// /favicon.svg again. Amber when a connection is slow or reconnecting.
const FRAMES = 12;
const FRAME_MS = 90;
const CIRCUMFERENCE = 2 * Math.PI * 30;
const ARC = CIRCUMFERENCE * 0.28;

const ARC_COLOR: Record<Exclude<ActivityState, "idle">, string> = {
  busy: "#FFE066",
  slow: "#FF9F1C",
  connecting: "#FF9F1C",
};

const cache = new Map<string, string>();

/// One frame of the icon as an SVG data URL: the static icon plus an arc
/// rotated `step`/FRAMES of a turn around the rim. Built once per (state, step)
/// and reused: there are only 12 x 3 distinct frames, so the animation never
/// rebuilds or re-encodes a string while it runs.
export function faviconFrame(step: number, state: Exclude<ActivityState, "idle">): string {
  const key = `${state}:${step}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const url = buildFrame(step, state);
  cache.set(key, url);
  return url;
}

function buildFrame(step: number, state: Exclude<ActivityState, "idle">): string {
  const angle = (step / FRAMES) * 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="30" fill="#1A1A1A" stroke="#E0A526" stroke-opacity=".45" stroke-width="3.5"/>` +
    `<ellipse cx="32" cy="33" rx="22" ry="15" fill="#D62828"/>` +
    `<path fill="#FFD21F" fill-rule="evenodd" d="M32 20.5 45 45.5h-7.2l-2-4.6H28.2l-2 4.6H19ZM32 30.2 29.9 36h4.2Z"/>` +
    `<circle cx="32" cy="32" r="30" fill="none" stroke="${ARC_COLOR[state]}" stroke-width="4.5" stroke-linecap="round" ` +
    `stroke-dasharray="${ARC.toFixed(1)} ${CIRCUMFERENCE.toFixed(1)}" transform="rotate(${angle} 32 32)"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function useAnimatedFavicon(): void {
  const state = useActivity();
  const phone = useReadOnlyPhone();

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
    if (!link) return;
    const rest = link.getAttribute("href") ?? "/favicon.svg";
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (state === "idle" || reduceMotion || phone) {
      link.setAttribute("href", rest);
      return;
    }
    let step = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const draw = () => link.setAttribute("href", faviconFrame(step++ % FRAMES, state));
    // A hidden tab is not looked at: the icon holds still until it is shown again
    // (browsers throttle background timers anyway, so this just saves the work).
    const sync = () => {
      clearInterval(timer);
      timer = undefined;
      if (document.visibilityState === "hidden") return;
      draw();
      timer = setInterval(draw, FRAME_MS);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
      link.setAttribute("href", rest);
    };
  }, [state, phone]);
}
