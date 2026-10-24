import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider, useTheme } from "./ThemeContext";

const root = document.documentElement;
const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;

beforeEach(() => {
  localStorage.clear();
  delete root.dataset.ui;
  delete root.dataset.theme;
  delete root.dataset.font;
  delete root.dataset.fs;
  document.head.querySelectorAll('link[id^="ae-webfont-"]').forEach((l) => l.remove());
});
afterEach(() => localStorage.clear());

describe("layout style", () => {
  it("defaults to classic, and puts it on <html> for the stylesheet", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.uiStyle).toBe("classic");
    expect(root.dataset.ui).toBe("classic");
  });

  it("switches to enterprise, applies it at once and remembers it", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setUiStyle("enterprise"));
    expect(result.current.uiStyle).toBe("enterprise");
    expect(root.dataset.ui).toBe("enterprise");
    expect(localStorage.getItem("ae-ui")).toBe("enterprise");
  });

  it("starts from the remembered choice", () => {
    localStorage.setItem("ae-ui", "enterprise");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.uiStyle).toBe("enterprise");
  });

  it("treats anything unrecognised as classic rather than breaking the layout", () => {
    localStorage.setItem("ae-ui", "neon");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.uiStyle).toBe("classic");
  });

  it("is independent of the color mode", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => {
      result.current.setUiStyle("enterprise");
      result.current.setTheme("dark");
    });
    expect(root.dataset.ui).toBe("enterprise");
    expect(root.dataset.theme).toBe("dark");
    act(() => result.current.toggleTheme());
    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.ui).toBe("enterprise");
  });









  it.each(["brutal", "flat", "glass", "minimal", "skeuo", "aurora"] as const)("switches to %s, applies it at once and remembers it", (style) => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setUiStyle(style));
    expect(result.current.uiStyle).toBe(style);
    expect(root.dataset.ui).toBe(style);
    expect(localStorage.getItem("ae-ui")).toBe(style);
  });

  it.each(["brutal", "flat", "glass", "minimal", "skeuo", "aurora"] as const)("restores a remembered %s theme", (style) => {
    localStorage.setItem("ae-ui", style);
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.uiStyle).toBe(style);
  });

  it.each(["gradient", "ledger", "slate", "card"])("falls back to classic for the retired %s theme", (old) => {
    localStorage.setItem("ae-ui", old);
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.uiStyle).toBe("classic");
  });
});

describe("font settings", () => {
  it("defaults to Inter at the default size, and puts both on <html> for the stylesheet", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.fontFamily).toBe("inter");
    expect(result.current.fontSize).toBe("md");
    expect(root.dataset.font).toBe("inter");
    expect(root.dataset.fs).toBe("md");
  });

  it.each(["inter", "hyperlegible", "plex", "system", "serif", "mono"] as const)("switches to %s, applies it at once and remembers it", (font) => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setFontFamily(font));
    expect(root.dataset.font).toBe(font);
    expect(localStorage.getItem("ae-font")).toBe(font);
  });

  it.each(["sm", "md", "lg", "xl"] as const)("switches the text size to %s, applies it at once and remembers it", (size) => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setFontSize(size));
    expect(root.dataset.fs).toBe(size);
    expect(localStorage.getItem("ae-font-size")).toBe(size);
  });

  it("starts from the remembered choices", () => {
    localStorage.setItem("ae-font", "serif");
    localStorage.setItem("ae-font-size", "lg");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.fontFamily).toBe("serif");
    expect(result.current.fontSize).toBe("lg");
    expect(root.dataset.font).toBe("serif");
    expect(root.dataset.fs).toBe("lg");
  });

  it("treats an unrecognised stored value as the default rather than breaking the page", () => {
    localStorage.setItem("ae-font", "comic");
    localStorage.setItem("ae-font-size", "huge");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.fontFamily).toBe("inter");
    expect(result.current.fontSize).toBe("md");
  });

  it("resets both to the default", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => {
      result.current.setFontFamily("mono");
      result.current.setFontSize("xl");
    });
    act(() => result.current.resetFont());
    expect(root.dataset.font).toBe("inter");
    expect(root.dataset.fs).toBe("md");
  });

  it("is independent of the theme and the colour mode", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setFontFamily("system"));
    act(() => result.current.setUiStyle("enterprise"));
    act(() => result.current.setTheme("dark"));
    expect(root.dataset.font).toBe("system");
    expect(result.current.fontFamily).toBe("system");
  });

  it("fetches a web font only when it is chosen, and only once", () => {
    const links = () => document.head.querySelectorAll('link[id^="ae-webfont-"]');
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(links()).toHaveLength(0); // Inter ships with the page
    act(() => result.current.setFontFamily("system"));
    act(() => result.current.setFontFamily("serif"));
    expect(links()).toHaveLength(0); // system fonts need no download
    act(() => result.current.setFontFamily("plex"));
    expect(links()).toHaveLength(1);
    expect((links()[0] as HTMLLinkElement).href).toContain("IBM+Plex+Sans");
    act(() => result.current.setFontFamily("inter"));
    act(() => result.current.setFontFamily("plex"));
    expect(links()).toHaveLength(1);
  });
});
