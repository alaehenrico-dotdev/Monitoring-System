import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";

/// The visual theme, chosen in Settings > Appearance. "classic" is the original
/// look (glass header, cream surfaces); the others restyle the SAME pages ("studio"
/// also moves the navigation tabs into a strip under the header). Independent of
/// the light/dark color mode, a per-browser preference, and it changes only how
/// things are drawn, never the pages or the data. A saved choice that is no longer
/// in this list (a removed theme) falls back to DEFAULT_UI_STYLE.
export type UiStyle = "classic" | "brutal" | "glass" | "minimal" | "skeuo" | "studio";

const UI_STYLES: readonly UiStyle[] = ["classic", "brutal", "glass", "minimal", "skeuo", "studio"];

/// How the pinned header and its toolbar are LAID OUT (Settings > Appearance > Header). Separate
/// from the visual theme above, so any header layout works with any theme and either color mode:
/// the theme paints, this arranges. Every layout keeps the header pinned to the top of the page and
/// every control reachable; they differ in how much room they take and where things sit.
///  - standard: the original - tabs strip on top, then a card with the title and the toolbar under it.
///  - compact:  dense - one slim line (seal, title, clock) and the toolbar on a full-width line under
///              it - about a third less height, to leave more room for the data.
///  - floating: a rounded panel inset from the edges, tabs as a pill switcher, toolbar in a tray.
///  - centered: everything centered - logo, title, toolbar and tabs - with the clock in the corner.
/// Stored per browser like the theme. A saved value no longer in this list falls back to standard.
export type HeaderStyle = "standard" | "compact" | "floating" | "centered";
export const HEADER_STYLES: readonly HeaderStyle[] = ["standard", "compact", "floating", "centered"];
export const DEFAULT_HEADER_STYLE: HeaderStyle = "standard";

/// The interface typeface and text size (Settings > Appearance > Font). Like the
/// theme they are a per-browser preference, applied as data attributes on <html>
/// that index.css keys off. The data tables are not scaled by the text size - they
/// have their own View > Zoom.
export type FontFamily = "inter" | "hyperlegible" | "plex" | "system" | "serif" | "mono";
export type FontSize = "sm" | "md" | "lg" | "xl";

export const FONT_FAMILIES: readonly FontFamily[] = ["inter", "hyperlegible", "plex", "system", "serif", "mono"];
const FONT_SIZES: readonly FontSize[] = ["sm", "md", "lg", "xl"];
/// What someone who has not picked a layout in Settings > Appearance gets: the plain,
/// quiet one. A saved choice always wins.
const DEFAULT_UI_STYLE: UiStyle = "minimal";
export const DEFAULT_FONT: FontFamily = "inter";
export const DEFAULT_FONT_SIZE: FontSize = "md";

/// Google Fonts families fetched only when chosen (Inter ships with the page and
/// the rest are system fonts). The stylesheet is added once, on demand.
const WEB_FONTS: Partial<Record<FontFamily, string>> = {
  hyperlegible: "Atkinson+Hyperlegible:wght@400;700",
  plex: "IBM+Plex+Sans:wght@400;600",
};

export function ensureWebFont(font: FontFamily) {
  const family = WEB_FONTS[font];
  const id = `ae-webfont-${font}`;
  if (!family || typeof document === "undefined" || document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  document.head.appendChild(link);
}

const STORAGE_KEY = "ae-theme";
const UI_STORAGE_KEY = "ae-ui";
const HEADER_STORAGE_KEY = "ae-header";
const FONT_STORAGE_KEY = "ae-font";
const FONT_SIZE_STORAGE_KEY = "ae-font-size";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  uiStyle: UiStyle;
  setUiStyle: (style: UiStyle) => void;
  headerStyle: HeaderStyle;
  setHeaderStyle: (style: HeaderStyle) => void;
  fontFamily: FontFamily;
  setFontFamily: (font: FontFamily) => void;
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
  /// Back to Inter at the default size.
  resetFont: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialUiStyle(): UiStyle {
  try {
    const stored = localStorage.getItem(UI_STORAGE_KEY);
    return UI_STYLES.find((u) => u === stored) ?? DEFAULT_UI_STYLE;
  } catch {
    return DEFAULT_UI_STYLE;
  }
}

function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return allowed.find((v) => v === stored) ?? fallback;
  } catch {
    return fallback;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [uiStyle, setUiStyle] = useState<UiStyle>(getInitialUiStyle);
  const [headerStyle, setHeaderStyle] = useState<HeaderStyle>(() => readChoice(HEADER_STORAGE_KEY, HEADER_STYLES, DEFAULT_HEADER_STYLE));
  const [fontFamily, setFontFamily] = useState<FontFamily>(() => readChoice(FONT_STORAGE_KEY, FONT_FAMILIES, DEFAULT_FONT));
  const [fontSize, setFontSize] = useState<FontSize>(() => readChoice(FONT_SIZE_STORAGE_KEY, FONT_SIZES, DEFAULT_FONT_SIZE));

  // useLayoutEffect (not useEffect) so this commits synchronously in the
  // same tick as the state update - ThemeToggle wraps its toggle in
  // flushSync() specifically so this attribute is already on <html> before
  // the View Transition API takes its "after" snapshot; with the async
  // useEffect that snapshot would still show the old theme.
  // Only the attribute lives here: the localStorage write below is a
  // synchronous disk-backed call, and doing it inside this layout effect
  // would put it on the critical path of the transition's snapshot.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // The theme is only an attribute too: index.css keys each
  // look off `:root[data-ui="..."]`, so no component needs to know.
  useLayoutEffect(() => {
    document.documentElement.dataset.ui = uiStyle;
  }, [uiStyle]);

  // The header layout is an attribute as well (styles/header-styles.css keys off it).
  useLayoutEffect(() => {
    document.documentElement.dataset.header = headerStyle;
  }, [headerStyle]);

  useEffect(() => {
    try {
      localStorage.setItem(HEADER_STORAGE_KEY, headerStyle);
    } catch {
      // Not remembered, still applied for this session.
    }
  }, [headerStyle]);

  // Typeface and size are attributes on <html> too (index.css reads them). A web
  // font is requested only once it is picked; until it arrives the fallback shows.
  useLayoutEffect(() => {
    document.documentElement.dataset.font = fontFamily;
    ensureWebFont(fontFamily);
  }, [fontFamily]);

  useLayoutEffect(() => {
    document.documentElement.dataset.fs = fontSize;
  }, [fontSize]);

  useEffect(() => {
    try {
      localStorage.setItem(FONT_STORAGE_KEY, fontFamily);
    } catch {
      // Not remembered, still applied for this session.
    }
  }, [fontFamily]);

  useEffect(() => {
    try {
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, fontSize);
    } catch {
      // Not remembered, still applied for this session.
    }
  }, [fontSize]);

  useEffect(() => {
    try {
      localStorage.setItem(UI_STORAGE_KEY, uiStyle);
    } catch {
      // Not remembered, still applied for this session.
    }
  }, [uiStyle]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage blocked/full (private mode, quota) - the theme still applies
      // for this session, it just won't be remembered.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  }, []);

  // Stable value: consumers only re-render when the theme actually changes,
  // not whenever the provider itself re-renders.
  const resetFont = useCallback(() => {
    setFontFamily(DEFAULT_FONT);
    setFontSize(DEFAULT_FONT_SIZE);
  }, []);

  const value = useMemo(
    () => ({ theme, toggleTheme, setTheme, uiStyle, setUiStyle, headerStyle, setHeaderStyle, fontFamily, setFontFamily, fontSize, setFontSize, resetFont }),
    [theme, toggleTheme, uiStyle, headerStyle, fontFamily, fontSize, resetFont],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

/// The header layout for a component that only needs to adapt to it (the page header sizes its logo
/// by it). Unlike useTheme it does not throw outside a ThemeProvider - a header rendered on its own
/// (a test, a print view) is simply the standard layout.
export function useHeaderStyle(): HeaderStyle {
  return useContext(ThemeContext)?.headerStyle ?? DEFAULT_HEADER_STYLE;
}
