import { useEffect, useRef } from "react";

/**
 * Soft white aura that follows the cursor, always on, painted behind the
 * whole app (z-index 0, under .ae-main) so it glows faintly through the
 * translucent cards, header and tables.
 *
 * Two large, very soft blobs (a white core and a fainter one that
 * trails slightly behind) chase the pointer with a little lag, like a light
 * dragged under glass. `transform`-only, no layout and no React state: one
 * requestAnimationFrame loop moves the layers directly. The loop pauses while
 * the window is hidden, and `prefers-reduced-motion` removes the lag.
 */
interface BlobConf {
  rgb: string;
  size: number;
  /** Follow speed per 1/60s frame (higher = tighter to the cursor). */
  follow: number;
  /** Peak alpha at the blob's center. */
  alpha: number;
}

const BLOBS: BlobConf[] = [
  { rgb: "255,255,255", size: 300, follow: 0.055, alpha: 0.22 },
  { rgb: "255,255,255", size: 200, follow: 0.09, alpha: 0.1 },
];

export function CursorAura() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const blobEls = Array.from(
      root.querySelectorAll<HTMLElement>("[data-aura-blob]"),
    );
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let tx = window.innerWidth / 2;
    let ty = window.innerHeight / 3;
    const pos = BLOBS.map(() => ({ x: tx, y: ty }));
    let raf = 0;
    let last = performance.now();

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      tx = e.clientX;
      ty = e.clientY;
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const frames = Math.min((now - last) / 1000, 0.1) * 60;
      last = now;
      for (let i = 0; i < BLOBS.length; i++) {
        const c = BLOBS[i];
        const k = reduce ? 1 : 1 - Math.pow(1 - c.follow, frames);
        const p = pos[i];
        p.x += (tx - p.x) * k;
        p.y += (ty - p.y) * k;
        blobEls[i].style.transform = `translate3d(${p.x - c.size / 2}px, ${
          p.y - c.size / 2
        }px, 0)`;
      }
    };

    const start = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      stop();
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div ref={rootRef} aria-hidden className="ae-aura no-print">
      {BLOBS.map((b, i) => (
        <div
          key={i}
          data-aura-blob
          className="ae-aura-blob"
          style={{
            width: b.size,
            height: b.size,
            background: `radial-gradient(circle, rgba(${b.rgb},${b.alpha}) 0%, rgba(${b.rgb},${b.alpha * 0.45}) 38%, rgba(${b.rgb},0) 70%)`,
          }}
        />
      ))}
    </div>
  );
}
