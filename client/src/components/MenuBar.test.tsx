import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MenuBar, type MenuDef } from "./MenuBar";

const select = {
  undo: vi.fn(),
  redo: vi.fn(),
  discard: vi.fn(),
  zoomIn: vi.fn(),
  pdf: vi.fn(),
};

const menus = (): MenuDef[] => [
  {
    id: "edit",
    label: "Edit",
    sections: [
      {
        items: [
          { id: "undo", label: "Undo", shortcut: "Ctrl+Z", onSelect: select.undo },
          { id: "redo", label: "Redo", disabledReason: "Nothing to redo", onSelect: select.redo },
        ],
      },
      { items: [{ id: "discard", label: "Discard changes…", tone: "danger", onSelect: select.discard }] },
    ],
  },
  { id: "view", label: "View", sections: [{ items: [{ id: "zoomIn", label: "Zoom in", onSelect: select.zoomIn }] }] },
  { id: "export", label: "Export", sections: [{ items: [{ id: "pdf", label: "PDF", onSelect: select.pdf }] }] },
];

const trigger = (name: string) => screen.getByRole("menuitem", { name: new RegExp(`^${name}`) });
const open = () => {
  render(
    <>
      <button type="button">outside</button>
      <MenuBar label="Sheet menus" menus={menus()} />
    </>,
  );
};

beforeEach(() => vi.clearAllMocks());

describe("MenuBar structure and roles", () => {
  it("is a menubar of menu triggers, with one tab stop (roving tabindex)", () => {
    open();
    expect(screen.getByRole("menubar", { name: "Sheet menus" })).toBeTruthy();
    const triggers = screen.getAllByRole("menuitem");
    expect(triggers.map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    for (const t of triggers) {
      expect(t.getAttribute("aria-haspopup")).toBe("menu");
      expect(t.getAttribute("aria-expanded")).toBe("false");
    }
  });

  it("opens a menu with role=menu and menuitem rows, naming the shortcut", () => {
    open();
    fireEvent.click(trigger("Edit"));
    const menu = screen.getByRole("menu", { name: "Edit" });
    expect(trigger("Edit").getAttribute("aria-expanded")).toBe("true");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Undo")]));
    const undo = within(menu).getByRole("menuitem", { name: /Undo/ });
    expect(undo.getAttribute("aria-keyshortcuts")).toBe("Control+Z");
    expect(within(menu).getByText("Ctrl+Z")).toBeTruthy();
  });

  it("leaves the rest of the page alone while a menu is open: no backdrop, nothing modal", () => {
    open();
    fireEvent.click(trigger("Edit"));
    expect(document.querySelector("[aria-modal]")).toBeNull();
    expect((screen.getByRole("button", { name: "outside" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("keyboard", () => {
  it("ArrowDown on a trigger opens its menu with the first item focused; ArrowUp opens at the last", () => {
    open();
    fireEvent.keyDown(trigger("Edit"), { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Undo");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    fireEvent.keyDown(trigger("Edit"), { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toContain("Discard changes");
  });

  it("Up/Down move within the menu and wrap; Home/End jump", () => {
    open();
    fireEvent.keyDown(trigger("Edit"), { key: "ArrowDown" });
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Redo");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Discard");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Undo"); // wrapped
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toContain("Discard"); // wrapped back
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement?.textContent).toContain("Undo");
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement?.textContent).toContain("Discard");
  });

  it("a letter jumps to the next item starting with it", () => {
    open();
    fireEvent.keyDown(trigger("Edit"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "d" });
    expect(document.activeElement?.textContent).toContain("Discard");
  });

  it("Enter chooses the item, closes the menu and returns focus to the trigger", () => {
    open();
    fireEvent.keyDown(trigger("Edit"), { key: "ArrowDown" });
    fireEvent.click(document.activeElement!); // Enter/Space on a button is a click
    expect(select.undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger("Edit"));
  });

  it("Escape closes and returns focus to the trigger", () => {
    open();
    fireEvent.keyDown(trigger("View"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger("View"));
  });

  it("Tab closes the menu and does not trap focus", () => {
    open();
    fireEvent.keyDown(trigger("Edit"), { key: "ArrowDown" });
    const notPrevented = fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(notPrevented).toBe(true); // default left alone, so focus moves on
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Left/Right move between triggers (wrapping) and Home/End jump to the first/last", () => {
    open();
    trigger("Edit").focus();
    fireEvent.keyDown(trigger("Edit"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(trigger("View"));
    expect(trigger("View").getAttribute("tabindex")).toBe("0");
    expect(trigger("Edit").getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(trigger("View"), { key: "ArrowLeft" });
    fireEvent.keyDown(trigger("Edit"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(trigger("Export")); // wrapped
    fireEvent.keyDown(trigger("Export"), { key: "Home" });
    expect(document.activeElement).toBe(trigger("Edit"));
    fireEvent.keyDown(trigger("Edit"), { key: "End" });
    expect(document.activeElement).toBe(trigger("Export"));
  });

  it("with a menu open, Left/Right inside it switch to the neighbouring menu", () => {
    open();
    fireEvent.keyDown(trigger("Edit"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowRight" });
    expect(screen.getByRole("menu", { name: "View" })).toBeTruthy();
    expect(screen.queryByRole("menu", { name: "Edit" })).toBeNull();
    expect(document.activeElement?.textContent).toContain("Zoom in");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowLeft" });
    expect(screen.getByRole("menu", { name: "Edit" })).toBeTruthy();
  });
});

describe("pointer", () => {
  it("clicking the open trigger again closes it", () => {
    open();
    fireEvent.click(trigger("Edit"));
    fireEvent.click(trigger("Edit"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("hovering another menu while one is open switches to it; hovering with none open does nothing", () => {
    open();
    fireEvent.mouseEnter(trigger("View"));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(trigger("Edit"));
    fireEvent.mouseEnter(trigger("Export"));
    expect(screen.getByRole("menu", { name: "Export" })).toBeTruthy();
    expect(screen.queryByRole("menu", { name: "Edit" })).toBeNull();
  });

  it("an outside click closes it, and does not steal focus back", () => {
    open();
    fireEvent.click(trigger("Edit"));
    const outside = screen.getByRole("button", { name: "outside" });
    outside.focus();
    fireEvent.mouseDown(outside);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it("a click inside the menu does not close it as an outside click", () => {
    open();
    fireEvent.click(trigger("Edit"));
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeTruthy();
  });
});

describe("disabled items", () => {
  it("stay visible and focusable, explain themselves, and do nothing", () => {
    open();
    fireEvent.click(trigger("Edit"));
    const redo = screen.getByRole("menuitem", { name: /Redo/ });
    expect(redo.getAttribute("aria-disabled")).toBe("true");
    expect(redo.getAttribute("title")).toBe("Nothing to redo");
    expect(redo.getAttribute("tabindex")).not.toBeNull();
    // The reason is in the accessibility tree, not only a tooltip.
    const describedBy = redo.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)?.textContent).toBe("Nothing to redo");

    fireEvent.click(redo);
    expect(select.redo).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeTruthy(); // still open: nothing was chosen

    // Keyboard can reach it too, so its reason can be read.
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(redo);
  });
});

describe("choice items", () => {
  it("are menuitemradio and mark the current one with a check, not only a colour", () => {
    render(
      <MenuBar
        label="m"
        menus={[
          {
            id: "rows",
            label: "Rows",
            sections: [
              {
                heading: "Show",
                items: [
                  { id: "all", label: "All rows", checked: true },
                  { id: "changed", label: "Only changed", checked: false },
                ],
              },
            ],
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Rows/ }));
    const radios = screen.getAllByRole("menuitemradio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(radios[0].querySelector("svg")).not.toBeNull(); // the check mark
    expect(radios[1].querySelector("svg")).toBeNull();
    expect(screen.getByRole("group", { name: "Show" })).toBeTruthy();
  });
});
