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
  | "plus";

const UI_STYLES: readonly UiStyle[] = ["classic", "enterprise", "brutal", "flat", "glass", "minimal", "skeuo", "aurora", "plus"];

const STORAGE_KEY = "ae-theme";
const UI_STORAGE_KEY = "ae-ui";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  uiStyle: UiStyle;
  setUiStyle: (style: UiStyle) => void;
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [uiStyle, setUiStyle] = useState<UiStyle>(getInitialUiStyle);

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
  const value = useMemo(
    () => ({ theme, toggleTheme, setTheme, uiStyle, setUiStyle }),
    [theme, toggleTheme, uiStyle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
