import { colors } from "../theme";

/**
 * Recreation of the Ala Eh! Food Products circular seal - black ring, gold
 * border, curved "SPECIALLY MADE RECIPE" / "SA PANLASANG PINOY" border text,
 * salakot-hat silhouette, red banner with "Ala Eh!" in yellow, "FOOD
 * PRODUCTS" underneath, and the "By: Chef Jampong" script signature.
 *
 * No raster copy of the artwork lives in this repo, so this is a same-shapes,
 * same-palette rebuild for use at UI sizes (nav header, login page, favicon)
 * rather than a pixel copy. Swap for the real logo file (drop it in
 * client/public/ and reference it) if one becomes available.
 */
export function LogoMark({ size = 44, spin = 0 }: { size?: number; spin?: number }) {
  return (
    <svg className="ae-logo-mark" width={size} height={size} viewBox="0 0 200 200" role="img" aria-label="Ala Eh! Food Products">
      <defs>
        {/* Radius 85 hugs just inside the decorative ring, well clear of the
            inner content (hat/banner/wordmark), so the border text never
            collides with it. */}
        <path id="ala-eh-top-arc" d="M 20 72 A 85 85 0 0 1 180 72" />
        <path id="ala-eh-bottom-arc" d="M 35.5 154 A 85 85 0 0 0 164.5 154" />
        {/* Keeps the glint inside the gold border. */}
        <clipPath id="ala-eh-logo-clip">
          <circle cx="100" cy="100" r="94" />
        </clipPath>
        <linearGradient id="ala-eh-logo-glint" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <circle cx="100" cy="100" r="97" fill={colors.black} stroke={colors.gold} strokeWidth="6" />
      <circle cx="100" cy="100" r="85" fill="none" stroke={colors.gold} strokeWidth="1.5" opacity="0.6" />

      {/* The border lettering is its own group so it can turn while the hat,
          banner and wordmark stay put. `spin` counts how many full turns it
          has been asked to make; only ever going up means it always spins
          forward, and the CSS transition (.ae-logo-ring in index.css) lets a
          turn finish smoothly even if the pointer leaves halfway. */}
      <g className="ae-logo-ring" style={{ transform: `rotate(${spin * 360}deg)`, transformOrigin: "100px 100px" }}>
        <text fontFamily="Georgia, serif" fontSize="11.5" fontWeight="700" letterSpacing="2.2" fill={colors.cream}>
          <textPath href="#ala-eh-top-arc" startOffset="50%" textAnchor="middle">
            SPECIALLY MADE RECIPE
          </textPath>
        </text>
        <text fontFamily="Georgia, serif" fontSize="10.5" fontWeight="700" letterSpacing="1.1" fill={colors.cream}>
          <textPath href="#ala-eh-bottom-arc" startOffset="50%" textAnchor="middle">
            SA PANLASANG PINOY
          </textPath>
        </text>
      </g>

      {/* Salakot hat silhouette */}
      <path d="M55 85 Q100 40 145 85 Z" fill={colors.gold} />
      <ellipse cx="100" cy="85" rx="45" ry="6.5" fill={colors.goldDark} />
      <ellipse cx="74" cy="68" rx="9" ry="3.5" fill="#fff" opacity="0.85" transform="rotate(-25 74 68)" />
      <ellipse cx="123" cy="64" rx="6.5" ry="2.5" fill="#fff" opacity="0.7" transform="rotate(-15 123 64)" />

      {/* Red banner with wordmark */}
      <rect x="30" y="93" width="140" height="40" rx="20" fill={colors.red} />
      <text
        x="100"
        y="121"
        textAnchor="middle"
        fontFamily="'Baloo 2', Arial, sans-serif"
        fontWeight="800"
        fontStyle="italic"
        fontSize="27"
        fill={colors.yellow}
        stroke={colors.black}
        strokeWidth="1.3"
        paintOrder="stroke"
      >
        Ala Eh!
      </text>

      <text
        x="100"
        y="141"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontWeight="700"
        letterSpacing="1.3"
        fontSize="9.5"
        fill={colors.cream}
      >
        FOOD PRODUCTS
      </text>
      <text x="100" y="151.5" textAnchor="middle" fontFamily="'Brush Script MT', cursive" fontSize="8" fill={colors.gold}>
        By: Chef Jampong
      </text>

      {/* One light streak across the seal each time `spin` goes up. The
          `key` remounts it so the CSS animation restarts from the left. */}
      {spin > 0 && (
        <g clipPath="url(#ala-eh-logo-clip)" pointerEvents="none">
          <g transform="skewX(-20)">
            <rect key={spin} className="ae-logo-glint" x="-60" y="-10" width="46" height="220" fill="url(#ala-eh-logo-glint)" />
          </g>
        </g>
      )}
    </svg>
  );
}