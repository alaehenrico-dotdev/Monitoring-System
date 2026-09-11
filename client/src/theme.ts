/**
 * Ala Eh! Food Products brand palette, taken from the official seal (black
 * ring, gold border, salakot-hat silhouette, red banner, yellow "Ala Eh!"
 * lettering). Every page should pull colors from here instead of inlining
 * hex codes, so the brand stays consistent and easy to retune in one place.
 */
export const colors = {
  black: "#14110D", // seal background
  blackSoft: "#1D1812", // sidebar / dark surfaces, slightly lifted off pure black
  gold: "#C99A2E", // seal ring + accents
  goldLight: "#E4B94D", // hover / highlight state for gold elements
  goldDark: "#8B6A1E", // borders, pressed state
  red: "#C1272D", // banner red - primary action color
  redDark: "#9E1F24", // hover/pressed red
  yellow: "#FFD400", // "Ala Eh!" lettering
  cream: "#F1E9D0", // "FOOD PRODUCTS" text, light text on dark surfaces
  paper: "#FFFCF5", // app content background - warm off-white, not stark white
  ink: "#241D14", // primary body text
  subtleInk: "#6B6255", // secondary/muted text
  border: "#E7DFC9", // hairline borders on light surfaces
  danger: "#C1272D", // reuse brand red for error/variance text
  warningBg: "#F7E7C2", // flagged-row tint (brand gold, softened)
  warningText: "#8B6A1E",
} as const;

export const fonts = {
  wordmark: "'Baloo 2', system-ui, sans-serif",
  body: "system-ui, -apple-system, 'Segoe UI', sans-serif",
} as const;
