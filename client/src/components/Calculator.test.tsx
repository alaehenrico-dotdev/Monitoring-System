import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HeaderCalculator } from "./Calculator";

const toast = vi.hoisted(() => vi.fn());
vi.mock("./Toast", () => ({ showToast: toast }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  toast.mockReset();
});

function open() {
  render(<HeaderCalculator />);
  fireEvent.click(screen.getByRole("button", { name: "Calculator" }));
  return screen.getByRole("group", { name: "Calculator" });
}

const key = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const type = (panel: HTMLElement, text: string) => {
  for (const ch of text) fireEvent.keyDown(panel, { key: ch });
};
const result = (panel: HTMLElement) => panel.querySelector(".ae-calc-result")!.textContent;
const expression = (panel: HTMLElement) => panel.querySelector(".ae-calc-expr")!.textContent;

describe("HeaderCalculator", () => {
  it("is closed until the icon is pressed, then opens a dialog and focuses it", () => {
    render(<HeaderCalculator />);
    expect(screen.queryByRole("group")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Calculator" }));
    const panel = screen.getByRole("group", { name: "Calculator" });
    expect(document.activeElement).toBe(panel);
    expect(screen.getByRole("button", { name: "Calculator" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on Escape and hands focus back to the icon", () => {
    const panel = open();
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("group")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Calculator" }));
  });

  it("closes when you click elsewhere, but not when you click inside it", () => {
    const panel = open();
    fireEvent.mouseDown(panel);
    expect(screen.queryByRole("group")).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("calculates from the keypad and shows the answer as you go", () => {
    const panel = open();
    key("1");
    key("2");
    key("Multiply");
    key("3");
    expect(expression(panel)).toBe("12×3");
    expect(result(panel)).toBe("36"); // live, before pressing equals
    key("Equals");
    expect(result(panel)).toBe("36");
    expect(expression(panel)).toBe("36");
  });

  it("calculates from the keyboard alone", () => {
    const panel = open();
    type(panel, "1,500".replace(",", "")); // 1500
    type(panel, "/4");
    fireEvent.keyDown(panel, { key: "Enter" });
    expect(result(panel)).toBe("375");
  });

  it("takes an x as multiply and = as equals", () => {
    const panel = open();
    type(panel, "6x7=");
    expect(result(panel)).toBe("42");
  });

  it("treats a percentage after + as a share of the left side", () => {
    const panel = open();
    type(panel, "200+10%");
    expect(result(panel)).toBe("220");
  });

  it("shows grouped thousands and no floating-point noise", () => {
    const panel = open();
    type(panel, "1234.5*1000");
    expect(result(panel)).toBe("1,234,500");
    fireEvent.keyDown(panel, { key: "c" });
    type(panel, "0.1+0.2");
    expect(result(panel)).toBe("0.3");
  });

  it("says so on a divide by zero and recovers with the next key", () => {
    const panel = open();
    type(panel, "5/0=");
    expect(result(panel)).toBe("Cannot divide by zero");
    fireEvent.keyDown(panel, { key: "c" });
    expect(result(panel)).toBe("0");
  });

  it("ignores a second decimal point, swaps a repeated operator, and only closes a bracket that is open", () => {
    const panel = open();
    type(panel, "1.5.2");
    expect(expression(panel)).toBe("1.52");
    fireEvent.keyDown(panel, { key: "c" });
    type(panel, "3+*4");
    expect(expression(panel)).toBe("3×4");
    fireEvent.keyDown(panel, { key: "c" });
    type(panel, "3)");
    expect(expression(panel)).toBe("3");
    type(panel, "*(2+1)");
    expect(result(panel)).toBe("9");
  });

  it("starts a new sum on a digit after an answer, and carries on from it on an operator", () => {
    const panel = open();
    type(panel, "2+3=");
    type(panel, "*4=");
    expect(result(panel)).toBe("20");
    type(panel, "7");
    expect(expression(panel)).toBe("7");
  });

  it("deletes one character with Backspace and clears with C", () => {
    const panel = open();
    type(panel, "123");
    fireEvent.keyDown(panel, { key: "Backspace" });
    expect(expression(panel)).toBe("12");
    key("Clear");
    expect(result(panel)).toBe("0");
  });

  it("keeps recent calculations (and remembers them) and reuses an answer", () => {
    const panel = open();
    type(panel, "10*5=");
    expect(panel.querySelector(".ae-calc-hist-item")?.textContent).toContain("= 50");
    expect(JSON.parse(localStorage.getItem("ae:calc-history")!)).toEqual([{ e: "10*5", r: 50 }]);
    fireEvent.keyDown(panel, { key: "c" });
    type(panel, "2+");
    fireEvent.click(panel.querySelector(".ae-calc-hist-item")!);
    expect(result(panel)).toBe("52");
  });

  it("does not log a lone number as a calculation", () => {
    const panel = open();
    type(panel, "5=");
    expect(panel.querySelector(".ae-calc-history")).toBeNull();
  });

  it("clears its history", () => {
    const panel = open();
    type(panel, "1+1=");
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    expect(panel.querySelector(".ae-calc-history")).toBeNull();
    expect(localStorage.getItem("ae:calc-history")).toBe("[]");
  });

  it("copies the answer as plain text and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const panel = open();
    type(panel, "1000*3=");
    fireEvent.click(screen.getByRole("button", { name: "Copy the answer" }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(writeText).toHaveBeenCalledWith("3000");
    expect(toast.mock.calls[0][0]).toBe("Copied 3,000");
    expect(result(panel)).toBe("3,000");
  });

  it("brings the sum and the open panel back after a page change, without taking focus", () => {
    const first = render(<HeaderCalculator />);
    fireEvent.click(screen.getByRole("button", { name: "Calculator" }));
    const panel = screen.getByRole("group", { name: "Calculator" });
    type(panel, "12*3");
    first.unmount(); // another page draws its own header

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    render(<HeaderCalculator />);
    const back = screen.getByRole("group", { name: "Calculator" });
    expect(expression(back)).toBe("12×3");
    expect(result(back)).toBe("36");
    expect(document.activeElement).toBe(input); // restored quietly, focus left where it was
    input.remove();
  });

  it("stays closed and empty on a fresh visit, and ignores a stored value it did not write", () => {
    sessionStorage.setItem("ae:calc-state", JSON.stringify({ open: true, expr: "alert(1)", fresh: false }));
    render(<HeaderCalculator />);
    expect(screen.queryByRole("group")).toBeNull();
    sessionStorage.setItem("ae:calc-state", "not json");
    render(<HeaderCalculator />);
    expect(screen.queryAllByRole("group")).toHaveLength(0);
  });

  it("remembers that the panel was closed", () => {
    const panel = open();
    type(panel, "5+5");
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(JSON.parse(sessionStorage.getItem("ae:calc-state")!)).toEqual({ open: false, expr: "5+5", fresh: false });
  });

  it("keeps its keys to itself: the page's own shortcuts never see them", () => {
    // The entry grid listens on the whole document and clears the selected cells on Delete, copies on
    // Ctrl+C and deselects on Esc. None of that may happen while typing in the calculator.
    const onDocKey = vi.fn();
    document.addEventListener("keydown", onDocKey);
    const panel = open();
    type(panel, "12*3");
    for (const k of ["Delete", "Backspace", "Enter", "Escape", "c"]) fireEvent.keyDown(panel, { key: k });
    expect(onDocKey).not.toHaveBeenCalled();
    document.removeEventListener("keydown", onDocKey);
  });

  it("is not a dialog, so it does not switch the grid's shortcuts off while it sits open", () => {
    // Delete / Ctrl+C / Esc on selected cells are skipped whenever [role="dialog"] is on screen.
    open();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("copies the answer on Ctrl+C, but leaves text the person selected alone", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const panel = open();
    type(panel, "6*7");
    fireEvent.keyDown(panel, { key: "c", ctrlKey: true });
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("42"));

    writeText.mockClear();
    const selection = vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "some text" } as unknown as Selection);
    fireEvent.keyDown(panel, { key: "c", ctrlKey: true });
    expect(writeText).not.toHaveBeenCalled();
    selection.mockRestore();
  });

  it("can use an answer that would be written in exponent form", () => {
    const panel = open();
    type(panel, "1/10000000=");
    expect(expression(panel)).toBe("0.0000001");
    type(panel, "*10=");
    expect(result(panel)).toBe("0.000001");
  });

  it("has nothing to copy until there is an answer", () => {
    open();
    expect((screen.getByRole("button", { name: "Copy the answer" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
