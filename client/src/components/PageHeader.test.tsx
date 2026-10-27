import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader";
import { beginActivity, resetActivity, SHOW_AFTER_MS } from "../utils/activity";

// Only the seal matters here; everything around it is stubbed.
vi.mock("./HeaderTabs", () => ({ HeaderTabs: () => null }));
vi.mock("./HeaderExtras", () => ({ HeaderExtras: () => null }));
vi.mock("./LogoMark", () => ({ LogoMark: ({ size }: { size: number }) => <span data-testid="logo" data-size={size} /> }));
vi.mock("../context/NavDrawerContext", () => ({ useNavDrawer: () => ({ open: false, toggle: vi.fn() }) }));
vi.mock("../hooks/useOnlineStatus", () => ({ useOnlineStatus: () => ({ online: true }) }));

beforeEach(() => {
  vi.useFakeTimers();
  resetActivity();
});
afterEach(() => {
  resetActivity();
  vi.useRealTimers();
});

const seal = () => screen.getByRole("button", { name: /navigation/i });
const beam = () => seal().querySelector(".ae-seal-beam") as HTMLElement;

describe("the header seal's loading beam", () => {
  it("is inside the seal button, so it circles the seal, and is quiet to begin with", () => {
    render(<PageHeader title="Reports" />);
    expect(beam()).not.toBeNull();
    expect(seal().contains(screen.getByTestId("logo"))).toBe(true);
    expect(beam()).toHaveClass("is-idle");
  });

  it("lights up while the system is saving or loading, and goes quiet after", () => {
    render(<PageHeader title="Reports" />);
    let end!: () => void;
    act(() => {
      end = beginActivity();
    });
    act(() => void vi.advanceTimersByTime(SHOW_AFTER_MS + 1));
    expect(beam()).toHaveClass("is-busy");
    act(() => end());
    act(() => void vi.advanceTimersByTime(1000));
    expect(beam()).toHaveClass("is-idle");
  });

  it("is sized to the seal (smaller when the header is collapsed to its title row)", () => {
    // No toolbar children: the header is the compact card, so the seal is the small one.
    render(<PageHeader title="Reports" />);
    expect(beam().style.getPropertyValue("--lp")).toBe(`${screen.getByTestId("logo").getAttribute("data-size")}px`);
  });
});
