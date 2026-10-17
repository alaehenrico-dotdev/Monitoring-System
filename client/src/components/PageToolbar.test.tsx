import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { BarButton, PageToolbar } from "./PageToolbar";
import { zoomSection } from "../utils/zoomMenu";

const menus = (onCsv = vi.fn()) => [
  {
    id: "export",
    label: "Export",
    sections: [{ items: [{ id: "csv", label: "Export CSV", onSelect: onCsv }, { id: "pdf", label: "Download PDF", disabledReason: "Run the report first" }] }],
  },
];

describe("PageToolbar", () => {
  it("renders the menus, filters, actions, primary and trailing control in the bar", () => {
    const { container } = render(
      <PageToolbar label="Test" menus={menus()} filters={<input aria-label="Filter" />} actions={<span>action</span>} primary={<button type="button">Go</button>} trailing={<span>zoom</span>} />,
    );
    const bar = container.querySelector(".ae-mb")!;
    expect(bar.classList.contains("ae-mb--page")).toBe(true);
    expect(within(screen.getByRole("menubar", { name: "Test menus" })).getByRole("menuitem", { name: /^Export/ })).toBeTruthy();
    expect(bar.querySelector(".ae-mb-filters")!.contains(screen.getByLabelText("Filter"))).toBe(true);
    expect(bar.querySelector(".ae-mb-actions")!.contains(screen.getByText("Go"))).toBe(true);
    expect(bar.querySelector(".ae-mb-divider")).not.toBeNull();
  });

  it("runs a menu item on click, and explains an unavailable one instead of running it", () => {
    const onCsv = vi.fn();
    render(<PageToolbar label="Test" menus={menus(onCsv)} />);
    fireEvent.click(screen.getAllByRole("menuitem", { name: /^Export/ })[0]);
    const pdf = screen.getByRole("menuitem", { name: /Download PDF/ });
    expect(pdf.getAttribute("aria-disabled")).toBe("true");
    expect(pdf.getAttribute("title")).toBe("Run the report first");
    fireEvent.click(screen.getByRole("menuitem", { name: "Export CSV" }));
    expect(onCsv).toHaveBeenCalledTimes(1);
  });

  it("builds the ... menu from the same items as the menus", () => {
    render(<PageToolbar label="Test" menus={menus()} />);
    const more = screen.getByRole("menubar", { name: "More actions" });
    fireEvent.click(within(more).getByRole("menuitem", { name: /More actions/ }));
    expect(screen.getByRole("menuitem", { name: "Export CSV" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Download PDF/ }).getAttribute("aria-disabled")).toBe("true");
  });

  it("shows a menu with one item as a plain button, and still lists it in the ... menu", () => {
    const onOne = vi.fn();
    render(<PageToolbar label="Test" menus={[{ id: "export", label: "Export", sections: [{ items: [{ id: "csv", label: "Export CSV", onSelect: onOne }] }] }]} />);
    expect(screen.queryByRole("menubar", { name: "Test menus" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(onOne).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByRole("menubar", { name: "More actions" })).getByRole("menuitem", { name: /More actions/ }));
    expect(screen.getByRole("menuitem", { name: "Export CSV" })).toBeTruthy();
  });

  it("shows Clear filters only while a filter is on, and clears them", () => {
    const onClear = vi.fn();
    const { rerender } = render(<PageToolbar label="Test" filters={<span>f</span>} activeFilters={0} onClearFilters={onClear} />);
    expect(screen.queryByRole("button", { name: /Clear filters/ })).toBeNull();
    rerender(<PageToolbar label="Test" filters={<span>f</span>} activeFilters={2} onClearFilters={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/ }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("has no menu group, divider or ... menu for a page without menus", () => {
    const { container } = render(<PageToolbar label="Test" filters={<span>f</span>} />);
    expect(screen.queryByRole("menubar")).toBeNull();
    expect(container.querySelector(".ae-mb-divider")).toBeNull();
    // The shared toolbar rules key on the first child, so it is always there, just hidden.
    expect((container.querySelector(".ae-mb")!.firstElementChild as HTMLElement).style.display).toBe("none");
  });
});

describe("BarButton", () => {
  it("is aria-disabled with its reason as the tooltip, stays focusable, and does not run", () => {
    const onClick = vi.fn();
    render(<BarButton label="Save" disabledReason="No changes to save" onClick={onClick} primary />);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.getAttribute("title")).toBe("No changes to save");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(btn.className).toContain("ae-mb-btn--primary");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("runs when available", () => {
    const onClick = vi.fn();
    render(<BarButton label="Save" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("zoomSection", () => {
  it("steps by 25 within 50-200 and says why a step is unavailable", () => {
    const onChange = vi.fn();
    const items = zoomSection(100, onChange).items;
    items[0].onSelect?.(document.body);
    items[1].onSelect?.(document.body);
    expect(onChange.mock.calls).toEqual([[125], [75]]);
    expect(zoomSection(200, onChange).items[0].disabledReason).toMatch(/200%/);
    expect(zoomSection(50, onChange).items[1].disabledReason).toMatch(/50%/);
    expect(zoomSection(100, onChange).items[2].disabledReason).toBe("Already at 100%");
  });
});
