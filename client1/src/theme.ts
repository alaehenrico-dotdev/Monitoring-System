/**
 * Ala Eh! Food Products brand palette, taken from the official seal (black
 * ring, gold border, salakot-hat silhouette, red banner, yellow "Ala Eh!"
 * lettering). Every page should pull colors from here instead of inlining
 * hex codes, so the brand stays consistent and easy to retune in one place.
 */
// Brand colors (seal, sidebar, receipt paper) stay fixed across light/dark
// mode - those surfaces are permanently dark or permanently paper-white by
// design, not part of the light/dark toggle. Only the tokens below that are
// backed by a CSS custom property (see :root / [data-theme="dark"] in
// index.css) actually flip when the theme toggle (ThemeContext) changes
// document.documentElement's data-theme attribute.
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
  paper: "var(--ae-bg)", // app content background
  paperAlt: "var(--ae-bg-alt)", // tinted rows (locked cells, subtotals, expanded diff rows)
  surface: "var(--ae-surface)", // card/input/modal background
  ink: "var(--ae-text)", // primary body text
  subtleInk: "var(--ae-text-muted)", // secondary/muted text
  border: "var(--ae-border)", // hairline borders
  danger: "#C1272D", // reuse brand red for error/variance text
  warningBg: "var(--ae-warning-bg)", // flagged-row tint
  warningText: "var(--ae-warning-text)",
  // Fixed light-surface text colors, for content that always renders on a
  // static white/paper background regardless of theme (the printed-receipt
  // look in ReceiptCard.tsx) - unlike `ink`/`subtleInk` above, these must
  // NOT flip in dark mode or the text would go light-on-white.
  staticInk: "#241D14",
  staticSubtleInk: "#6B6255",
} as const;

export const fonts = {
  wordmark: "'Baloo 2', system-ui, sans-serif",
  body: "system-ui, -apple-system, 'Segoe UI', sans-serif",
} as const;
