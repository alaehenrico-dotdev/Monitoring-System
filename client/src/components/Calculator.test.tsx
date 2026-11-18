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

describe("HeaderCalculator on a mobile view", () => {
  it("is not there at all: no icon, no panel, and Alt+C does nothing", () => {
    localStorage.setItem("ala-eh-force-phone", "1"); // the read-only phone / tablet view
    try {
      render(<HeaderCalculator />);
      expect(screen.queryByRole("button", { name: "Calculator" })).toBeNull();
      fireEvent.keyDown(document.body, { key: "c", code: "KeyC", altKey: true });
      expect(screen.queryByRole("group", { name: "Calculator" })).toBeNull();
    } finally {
      localStorage.removeItem("ala-eh-force-phone");
    }
  });

  it("does not bring back a panel that was left open on a computer", () => {
    sessionStorage.setItem("ae:calc-state", JSON.stringify({ open: true, expr: "5", fresh: false }));
    localStorage.setItem("ala-eh-force-phone", "1");
    try {
      render(<HeaderCalculator />);
      expect(screen.queryByRole("group", { name: "Calculator" })).toBeNull();
    } finally {
      localStorage.removeItem("ala-eh-force-phone");
    }
  });
});

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
    expect(screen.queryByRole("group", { name: "Calculator" })).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("group", { name: "Calculator" })).toBeNull();
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
    expect(screen.queryByRole("group", { name: "Calculator" })).toBeNull();
    sessionStorage.setItem("ae:calc-state", "not json");
    render(<HeaderCalculator />);
    expect(screen.queryAllByRole("group", { name: "Calculator" })).toHaveLength(0);
  });

  it("remembers that the panel was closed", () => {
    const panel = open();
    type(panel, "5+5");
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(JSON.parse(sessionStorage.getItem("ae:calc-state")!)).toEqual({ open: false, expr: "5+5", fresh: false, mode: "calc", tape: [], mem: null });
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

  describe("tape", () => {
    const tapeMode = (panel: HTMLElement) => {
      fireEvent.click(screen.getByRole("button", { name: "Tape" }));
      return panel;
    };
    const lines = () => Array.from(document.querySelectorAll(".ae-calc-tape-v")).map((n) => n.textContent);
    const total = () => document.querySelector(".ae-calc-tape-total strong")!.textContent;

    it("adds each number as a line with Enter and keeps a running total", () => {
      const panel = tapeMode(open());
      type(panel, "120");
      fireEvent.keyDown(panel, { key: "Enter" });
      type(panel, "35*2");
      fireEvent.keyDown(panel, { key: "Enter" });
      type(panel, "-5");
      key("Add to tape");
      expect(lines()).toEqual(["120", "70", "-5"]);
      expect(total()).toBe("185");
      expect(result(panel)).toBe("0");
    });

    it("removes a line and clears the tape", () => {
      const panel = tapeMode(open());
      for (const n of ["10", "20", "30"]) {
        type(panel, n);
        fireEvent.keyDown(panel, { key: "Enter" });
      }
      key("Remove line 2");
      expect(lines()).toEqual(["10", "30"]);
      expect(total()).toBe("40");
      fireEvent.click(screen.getByRole("button", { name: "Clear tape" }));
      expect(lines()).toEqual([]);
      expect(total()).toBe("0");
    });

    it("totals a pasted column of numbers, and ignores the labels in it", () => {
      const panel = open();
      fireEvent.paste(panel, { clipboardData: { getData: () => "Soy 1,250\nVinegar 300\nOil 12.5\n" } });
      expect(lines()).toEqual(["1,250", "300", "12.5"]);
      expect(total()).toBe("1,562.5");
    });

    it("keeps the tape across a page change", () => {
      const first = render(<HeaderCalculator />);
      fireEvent.click(screen.getByRole("button", { name: "Calculator" }));
      const panel = screen.getByRole("group", { name: "Calculator" });
      tapeMode(panel);
      type(panel, "7");
      fireEvent.keyDown(panel, { key: "Enter" });
      first.unmount();
      render(<HeaderCalculator />);
      expect(lines()).toEqual(["7"]);
    });
  });

  describe("memory and Ans", () => {
    it("adds to, recalls, subtracts from and clears the memory", () => {
      const panel = open();
      type(panel, "40");
      key("Add to memory");
      expect(panel.querySelector(".ae-calc-mem")!.textContent).toBe("M 40");
      key("Clear");
      type(panel, "15");
      key("Subtract from memory");
      expect(panel.querySelector(".ae-calc-mem")!.textContent).toBe("M 25");
      key("Clear");
      key("Memory recall");
      expect(result(panel)).toBe("25");
      key("Memory clear");
      expect(panel.querySelector(".ae-calc-mem")).toBeNull();
    });

    it("uses the last answer in the next sum", () => {
      const panel = open();
      type(panel, "6*7");
      fireEvent.keyDown(panel, { key: "Enter" });
      key("Clear");
      key("Last answer");
      type(panel, "+8");
      expect(result(panel)).toBe("50");
    });
  });

  describe("pack converter", () => {
    it("turns packs into pieces and pieces into packs with what is left over", () => {
      const panel = open();
      fireEvent.change(screen.getByLabelText("Pieces per pack"), { target: { value: "24" } });
      type(panel, "5");
      key("Packs to pieces");
      expect(result(panel)).toBe("120");
      key("Clear");
      type(panel, "100");
      key("Pieces to packs");
      expect(result(panel)).toBe("4.1666666667");
      expect(panel.querySelector(".ae-calc-note")!.textContent).toBe("= 4 packs + 4 pcs");
      expect(localStorage.getItem("ae:calc-pack")).toBe("24");
    });

    it("does nothing without a pack size", () => {
      const panel = open();
      type(panel, "5");
      expect((screen.getByRole("button", { name: "Packs to pieces" }) as HTMLButtonElement).disabled).toBe(true);
      expect(result(panel)).toBe("5");
    });

    it("does not treat typing in the pack field as keypad input", () => {
      const panel = open();
      type(panel, "9");
      const input = screen.getByLabelText("Pieces per pack");
      fireEvent.keyDown(input, { key: "4" });
      expect(expression(panel)).toBe("9");
    });
  });

  describe("format", () => {
    it("rounds the display and the copied text to the chosen decimals, and can drop the separators", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      const panel = open();
      type(panel, "10/3");
      expect(result(panel)).toBe("3.3333333333");
      fireEvent.click(screen.getByRole("button", { name: "Number format" }));
      fireEvent.click(screen.getByRole("button", { name: "2 decimals" }));
      expect(result(panel)).toBe("3.33");
      fireEvent.click(screen.getByRole("button", { name: "Copy the answer" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("3.33"));

      key("Clear");
      type(panel, "1234567");
      fireEvent.click(screen.getByRole("button", { name: "Thousands separators" }));
      expect(result(panel)).toBe("1234567.00");
      expect(JSON.parse(localStorage.getItem("ae:calc-fmt")!)).toEqual({ decimals: 2, grouping: false });
    });
  });

  describe("history", () => {
    it("keeps up to 20 calculations", () => {
      const panel = open();
      for (let i = 1; i <= 22; i++) {
        type(panel, `${i}+1`);
        fireEvent.keyDown(panel, { key: "Enter" });
        key("Clear");
      }
      expect(panel.querySelectorAll(".ae-calc-history li")).toHaveLength(20);
    });

    it("keeps a pinned calculation through clearing and newer ones", () => {
      const panel = open();
      type(panel, "2+2");
      fireEvent.keyDown(panel, { key: "Enter" });
      key("Clear");
      fireEvent.click(screen.getByRole("button", { name: /^Pin 2\+2/ }));
      key("Clear");
      type(panel, "3+3");
      fireEvent.keyDown(panel, { key: "Enter" });
      fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
      const left = Array.from(panel.querySelectorAll(".ae-calc-hist-expr")).map((n) => n.textContent);
      expect(left).toEqual(["2+2"]);
    });
  });

  describe("Alt+C", () => {
    it("opens and closes it from anywhere on the page, and from inside the panel", () => {
      render(<HeaderCalculator />);
      fireEvent.keyDown(document.body, { key: "c", code: "KeyC", altKey: true });
      const panel = screen.getByRole("group", { name: "Calculator" });
      fireEvent.keyDown(panel, { key: "c", code: "KeyC", altKey: true });
      expect(screen.queryByRole("group", { name: "Calculator" })).toBeNull();
      fireEvent.keyDown(document.body, { key: "c", code: "KeyC", altKey: true });
      expect(screen.queryByRole("group", { name: "Calculator" })).not.toBeNull();
      fireEvent.keyDown(document.body, { key: "c", code: "KeyC", altKey: true });
      expect(screen.queryByRole("group", { name: "Calculator" })).toBeNull();
    });
  });

  describe("never touches the page's entries", () => {
    it("stops every key, paste, copy and cut at the panel, so the grid's document-level handlers never run", () => {
      const seen: string[] = [];
      const log = (e: Event) => seen.push(e.type);
      for (const t of ["keydown", "paste", "copy", "cut"]) document.addEventListener(t, log);
      try {
        const panel = open();
        const input = screen.getByLabelText("Pieces per pack");
        for (const k of ["ArrowDown", "ArrowRight", "Tab", "Delete", "Backspace", "Enter", "5", "x", "F2"]) {
          fireEvent.keyDown(panel, { key: k });
        }
        fireEvent.keyDown(panel, { key: "c", ctrlKey: true });
        fireEvent.keyDown(panel, { key: "a", ctrlKey: true });
        fireEvent.paste(panel, { clipboardData: { getData: () => "1\n2\n3" } });
        fireEvent.copy(panel);
        fireEvent.cut(panel);
        // The pack-size field too.
        fireEvent.keyDown(input, { key: "ArrowDown" });
        fireEvent.paste(input, { clipboardData: { getData: () => "9" } });
        expect(seen).toEqual([]);
      } finally {
        for (const t of ["keydown", "paste", "copy", "cut"]) document.removeEventListener(t, log);
      }
    });

    it("has no control that can write to a cell, and leaves a cell on the page alone", () => {
      const panel = open();
      const cell = document.createElement("input");
      cell.value = "12";
      document.body.appendChild(cell);
      type(panel, "5+5");
      fireEvent.keyDown(panel, { key: "Enter" });
      fireEvent.paste(panel, { clipboardData: { getData: () => "99\n1" } });
      for (const name of ["Add to memory", "Memory recall", "Last answer"]) {
        const b = screen.queryByRole("button", { name });
        if (b && !(b as HTMLButtonElement).disabled) fireEvent.click(b);
      }
      expect(cell.value).toBe("12");
      const labels = Array.from(panel.querySelectorAll("button")).map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
      expect(labels.some((l) => /cell|sheet|insert|put in/i.test(l))).toBe(false);
      cell.remove();
    });
  });
});
