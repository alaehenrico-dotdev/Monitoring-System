import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";

/// The visual theme, chosen in Settings > Appearance. "classic" is the original
/// look (glass header, cream surfaces); "enterprise" is a more formal restyle of
/// the SAME layout - ink header bar with a gold rule, flat ruled tables, square
/// controls. Independent of the light/dark color mode, a per-browser preference,
/// and it changes only how things are drawn, never the pages or the data.
export type UiStyle =
  | "classic"
  | "enterprise"
  | "brutal"
  | "flat"
  | "glass"
  | "minimal"
  | "skeuo"
  | "aurora"
  | "plus"
  | "halloween";

const UI_STYLES: readonly UiStyle[] = ["classic", "enterprise", "brutal", "flat", "glass", "minimal", "skeuo", "aurora", "plus", "halloween"];

/// The interface typeface and text size (Settings > Appearance > Font). Like the
/// theme they are a per-browser preference, applied as data attributes on <html>
/// that index.css keys off. The data tables are not scaled by the text size - they
/// have their own View > Zoom.
export type FontFamily = "inter" | "hyperlegible" | "plex" | "system" | "serif" | "mono";
export type FontSize = "sm" | "md" | "lg" | "xl";

export const FONT_FAMILIES: readonly FontFamily[] = ["inter", "hyperlegible", "plex", "system", "serif", "mono"];
const FONT_SIZES: readonly FontSize[] = ["sm", "md", "lg", "xl"];
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
const FONT_STORAGE_KEY = "ae-font";
const FONT_SIZE_STORAGE_KEY = "ae-font-size";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  uiStyle: UiStyle;
  setUiStyle: (style: UiStyle) => void;
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
    return UI_STYLES.find((u) => u === stored) ?? "classic";
  } catch {
    return "classic";
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

  // The theme is only an attribute too: index.css keys the whole enterprise
  // look off `:root[data-ui="enterprise"]`, so no component needs to know.
  useLayoutEffect(() => {
    document.documentElement.dataset.ui = uiStyle;
  }, [uiStyle]);

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
    () => ({ theme, toggleTheme, setTheme, uiStyle, setUiStyle, fontFamily, setFontFamily, fontSize, setFontSize, resetFont }),
    [theme, toggleTheme, uiStyle, fontFamily, fontSize, resetFont],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
