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









  it.each(["brutal", "flat", "glass", "minimal", "skeuo", "carbon"] as const)("switches to %s, applies it at once and remembers it", (style) => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setUiStyle(style));
    expect(result.current.uiStyle).toBe(style);
    expect(root.dataset.ui).toBe(style);
    expect(localStorage.getItem("ae-ui")).toBe(style);
  });

  it.each(["brutal", "flat", "glass", "minimal", "skeuo", "carbon"] as const)("restores a remembered %s theme", (style) => {
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
