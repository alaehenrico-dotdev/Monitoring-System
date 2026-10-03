import { useEffect, useRef } from "react";
import logoVideo from "../assets/alaeh-logo-3d.webm";

/**
 * The animated Ala Eh! 3D logo (src/assets/alaeh-logo-3d.webm), used in the
 * page header and on the login screen.
 *
 * The webm carries an alpha channel, so it's rendered as-is on whatever
 * surface it sits on - no circular clip (that would crop the 3D artwork)
 * and no backdrop. `muted` + `playsInline` are required for autoplay on
 * browsers/iOS; `/alaeh-logo-3d-poster.png` (also alpha, matching the video)
 * is the poster shown until the video loads.
 *
 * The outer `.ae-logo-mark` wrapper is kept because the header's hover
 * scale+glow CSS (`.ae-page-header-logo .ae-logo-mark` in index.css)
 * targets it.
 *
 * Playback only runs while the logo is on screen and the tab is visible: the
 * video is paused when the tab is hidden or the logo scrolls out of view, and
 * resumed when it comes back, so it doesn't keep decoding frames nobody sees.
 *
 * `spin` is still accepted so existing callers (PageHeader's hover spin)
 * keep compiling, but it's ignored: the video animates on its own.
 */
export function LogoMark({ size = 44 }: { size?: number; spin?: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let onScreen = true;
    const sync = () => {
      if (onScreen && !document.hidden) {
        // play() returns a promise in browsers; guard for environments
        // (jsdom) where it doesn't, and ignore autoplay-policy rejections.
        const started = video.play() as Promise<void> | undefined;
        started?.catch?.(() => {});
      } else {
        video.pause();
      }
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            onScreen = entry.isIntersecting;
            sync();
          });
    observer?.observe(video);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <span
      className="ae-logo-mark"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      <video
        ref={videoRef}
        src={logoVideo}
        poster="/alaeh-logo-3d-poster.png"
        autoPlay
        loop
        muted
        playsInline
        aria-label="Ala Eh! Food Products"
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </span>
  );
}
