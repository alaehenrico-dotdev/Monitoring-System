import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSaveShortcut } from "./useSaveShortcut";

function press(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { cancelable: true, bubbles: true, ...init });
  window.dispatchEvent(event);
  return event;
}

describe("useSaveShortcut", () => {
  it("Ctrl+S saves and keeps the browser's Save page dialog from opening", () => {
    const onSave = vi.fn();
    renderHook(() => useSaveShortcut(onSave, true));
    const event = press({ key: "s", ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Cmd+S does the same on a Mac, and the letter's case does not matter", () => {
    const onSave = vi.fn();
    renderHook(() => useSaveShortcut(onSave, true));
    press({ key: "S", metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("ignores other combinations (Ctrl+Shift+S, Alt+Ctrl+S, plain s)", () => {
    const onSave = vi.fn();
    renderHook(() => useSaveShortcut(onSave, true));
    press({ key: "s", ctrlKey: true, shiftKey: true });
    press({ key: "s", ctrlKey: true, altKey: true });
    press({ key: "s" });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("on a read-only sheet leaves the shortcut to the browser", () => {
    const onSave = vi.fn();
    renderHook(() => useSaveShortcut(onSave, false));
    const event = press({ key: "s", ctrlKey: true });
    expect(onSave).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("always calls the latest handler, and stops listening on unmount", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ fn }) => useSaveShortcut(fn, true), { initialProps: { fn: first } });
    rerender({ fn: second });
    press({ key: "s", ctrlKey: true });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unmount();
    press({ key: "s", ctrlKey: true });
    expect(second).toHaveBeenCalledTimes(1);
  });
});
