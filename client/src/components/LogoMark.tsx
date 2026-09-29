import logoVideo from "../assets/alaeh-logo-3d.webm";

/**
 * The animated Ala Eh! 3D logo (src/assets/alaeh-logo-3d.webm), used in the
 * page header and on the login screen.
 *
 * The webm carries an alpha channel, so it's rendered as-is on whatever
 * surface it sits on - no circular clip (that would crop the 3D artwork)
 * and no backdrop. `muted` + `playsInline` are required for autoplay on
 * browsers/iOS; `/logo.jpg` is the poster shown until the video loads.
 *
 * The outer `.ae-logo-mark` wrapper is kept because the header's hover
 * scale+glow CSS (`.ae-page-header-logo .ae-logo-mark` in index.css)
 * targets it.
 *
 * `spin` is still accepted so existing callers (PageHeader's hover spin)
 * keep compiling, but it's ignored: the video animates on its own.
 */
export function LogoMark({ size = 44 }: { size?: number; spin?: number }) {
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
        src={logoVideo}
        poster="/logo.jpg"
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
