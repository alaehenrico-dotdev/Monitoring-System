/**
 * The real Ala Eh! Food Products circular seal (client/public/logo.jpg) -
 * this used to be a hand-drawn same-shapes recreation, kept only because
 * no raster copy of the real artwork lived in this repo yet; swapped for
 * the actual logo now that one's available.
 *
 * The source file is a 960x960 JPEG with a solid white square background
 * (JPEG has no alpha channel) - the outer wrapper clips it to a circle via
 * `overflow: hidden` + `borderRadius: 50%`, so the white corners never
 * show against a dark surface (the sidebar, the login page) the same way
 * they'd be invisible against a white one (the receipt paper/PDF).
 *
 * Two nested elements, matching the class names Sidebar.tsx's own hover
 * CSS (index.css) already targets:
 *  - the outer `.ae-logo-mark` gets Sidebar's hover scale+glow - untouched
 *    by this swap, still a plain CSS class rule, no inline transform here
 *    to conflict with it.
 *  - the inner `.ae-logo-ring` is what actually spins (`rotate()` from
 *    `spin`, see index.css's `.ae-logo-ring` transition) - kept as an
 *    inner element rather than putting the rotation on the same node as
 *    the hover scale, exactly like the old SVG version split its border
 *    lettering (rotates) from its outer root (scales).
 */
export function LogoMark({ size = 44, spin = 0 }: { size?: number; spin?: number }) {
  return (
    <span
      className="ae-logo-mark"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <img
        className="ae-logo-ring"
        src="/logo.jpg"
        alt="Ala Eh! Food Products"
        width={size}
        height={size}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `rotate(${spin * 360}deg)`,
          transformOrigin: "50% 50%",
        }}
      />
    </span>
  );
}
