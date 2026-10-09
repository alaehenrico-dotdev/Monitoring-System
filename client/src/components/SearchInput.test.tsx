import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SearchInput } from "./SearchInput";

function Harness({ initial = "", spy }: { initial?: string; spy?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <SearchInput
      value={value}
      onChange={(v) => {
        spy?.(v);
        setValue(v);
      }}
    />
  );
}

const toggle = () => screen.getByRole("button", { name: "Search" });
const input = () => screen.getByRole("searchbox");
const isOpen = () => toggle().getAttribute("aria-expanded") === "true";

describe("SearchInput", () => {
  it("starts as just the icon", () => {
    render(<Harness />);
    expect(isOpen()).toBe(false);
    expect(toggle().closest(".ae-search")!.classList.contains("ae-search--open")).toBe(false);
  });

  it("opens and focuses the box when the icon is clicked", () => {
    render(<Harness />);
    fireEvent.click(toggle());
    expect(document.activeElement).toBe(input());
    expect(isOpen()).toBe(true);
  });

  it("folds back to the icon on blur when empty", () => {
    render(<Harness />);
    fireEvent.focus(input());
    expect(isOpen()).toBe(true);
    fireEvent.blur(input());
    expect(isOpen()).toBe(false);
  });

  it("stays open while it holds a search, so an active filter is never hidden", () => {
    render(<Harness initial="soy" />);
    expect(isOpen()).toBe(true);
    fireEvent.focus(input());
    fireEvent.blur(input());
    expect(isOpen()).toBe(true);
  });

  it("Escape clears the search and folds it away", () => {
    const spy = vi.fn();
    render(<Harness initial="soy" spy={spy} />);
    fireEvent.click(toggle()); // really focuses the input, so blur() has something to blur
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(spy).toHaveBeenCalledWith("");
    expect(isOpen()).toBe(false);
  });

  it("only takes keyboard focus once open", () => {
    render(<Harness />);
    expect(input().tabIndex).toBe(-1);
    fireEvent.click(toggle());
    expect(input().tabIndex).toBe(0);
  });
});
