import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PhoneBottomNav } from "./PhoneBottomNav";
import { pagesForRole } from "../config/navigation";

const auth = vi.hoisted(() => ({ user: { id: 1, role: "SUPERVISOR_ADMIN" } as Record<string, unknown> | null }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => auth }));

function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PhoneBottomNav />
    </MemoryRouter>,
  );
}

const names = () => screen.getAllByRole("link").map((a) => a.getAttribute("aria-label"));

describe("PhoneBottomNav", () => {
  beforeEach(() => localStorage.clear());

  it("lists every phone page for an admin, by its full name, shown in full", () => {
    auth.user = { id: 1, role: "SUPERVISOR_ADMIN" };
    open("/dashboard");

    expect(names()).toEqual(pagesForRole("SUPERVISOR_ADMIN", true).map((p) => p.label));
    expect(names()).toHaveLength(6);
    for (const label of ["Consolidated", "Change Log", "Dashboard", "Settings"]) {
      expect(screen.getByRole("link", { name: label }).textContent).toBe(label);
    }
  });

  it("leaves out the pages an Encoder may not open, and keeps the Daily Report they land on", () => {
    auth.user = { id: 2, role: "ENCODER" };
    open("/daily-report");

    expect(names()).toEqual(["Daily Report", "Consolidated", "Daily Out", "Settings"]);
    expect(screen.getByRole("link", { name: "Daily Report" }).getAttribute("aria-current")).toBe("page");
  });

  it("marks the page that is open, and only that one", () => {
    auth.user = { id: 1, role: "SUPERVISOR_ADMIN" };
    open("/daily-out");

    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.getAttribute("aria-label"))).toEqual(["Daily Out"]);
  });

  it("is split into a left and a right pill by default, the dots on the right one", () => {
    auth.user = { id: 1, role: "SUPERVISOR_ADMIN" };
    const { container } = open("/dashboard");

    const bars = container.querySelectorAll(".ae-bottomnav-bar");
    expect(bars).toHaveLength(2);
    expect(bars[0].querySelectorAll("a")).toHaveLength(3);
    expect(bars[1].querySelectorAll("a")).toHaveLength(3);
    expect(bars[0].querySelector(".ae-bottomnav-dots")).toBeNull();
    expect(bars[1].querySelector(".ae-bottomnav-dots")).not.toBeNull();
  });

  it("switches to one centered pill from the three-dots menu, and remembers it", () => {
    auth.user = { id: 1, role: "SUPERVISOR_ADMIN" };
    const { container, unmount } = open("/dashboard");

    fireEvent.click(screen.getByRole("button", { name: "Navigation layout" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Centered" }));

    expect(container.querySelectorAll(".ae-bottomnav-bar")).toHaveLength(1);
    expect(container.querySelector(".ae-bottomnav")?.getAttribute("data-layout")).toBe("centered");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(names()).toHaveLength(6);

    unmount();
    const again = open("/dashboard");
    expect(again.container.querySelectorAll(".ae-bottomnav-bar")).toHaveLength(1);

    // The dots are still there, to go back.
    fireEvent.click(screen.getByRole("button", { name: "Navigation layout" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Split/ }));
    expect(again.container.querySelectorAll(".ae-bottomnav-bar")).toHaveLength(2);
  });

  it("switching layout leaves an inert ghost of the old pills for the animation, and clears it afterwards", () => {
    auth.user = { id: 1, role: "SUPERVISOR_ADMIN" };
    const finish: Array<() => void> = [];
    const original = Element.prototype.animate;
    // jsdom has no Web Animations; a stand-in that lets the test finish the ghost's fade by hand.
    Element.prototype.animate = vi.fn(function () {
      const anim: { onfinish: null | (() => void) } = { onfinish: null };
      finish.push(() => anim.onfinish?.());
      return anim;
    }) as never;
    try {
      const { container } = open("/dashboard");
      fireEvent.click(screen.getByRole("button", { name: "Navigation layout" }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Centered" }));

      expect(container.querySelectorAll(".ae-bottomnav-bar")).toHaveLength(1);
      const ghosts = document.body.querySelectorAll(":scope > .ae-bottomnav-bar");
      expect(ghosts).toHaveLength(2); // the two old pills, merging
      expect(ghosts[0].getAttribute("aria-hidden")).toBe("true");
      expect(ghosts[0].hasAttribute("inert")).toBe(true);

      finish.forEach((f) => f());
      expect(document.body.querySelectorAll(":scope > .ae-bottomnav-bar")).toHaveLength(0);
    } finally {
      Element.prototype.animate = original;
    }
  });

  it("going to split starts the two new pills over the old one, with no ghost kept", () => {
    auth.user = { id: 1, role: "SUPERVISOR_ADMIN" };
    localStorage.setItem("ae:phone-nav-layout", "centered");
    const original = Element.prototype.animate;
    const animate = vi.fn(() => ({ onfinish: null }));
    Element.prototype.animate = animate as never;
    try {
      const { container } = open("/dashboard");
      expect(container.querySelectorAll(".ae-bottomnav-bar")).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: "Navigation layout" }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Split (both sides)" }));

      expect(container.querySelectorAll(".ae-bottomnav-bar")).toHaveLength(2);
      expect(document.body.querySelectorAll(":scope > .ae-bottomnav-bar")).toHaveLength(0);
      // Each new pill is animated by a slide only (no scale, no opacity).
      const frames = (animate.mock.calls as unknown as Array<[Array<Record<string, string>>]>).map((c) => c[0]).flat();
      expect(frames.some((f) => typeof f.transform === "string" && f.transform.includes("scale"))).toBe(false);
      expect(frames.some((f) => "opacity" in f && "transform" in f)).toBe(false);
    } finally {
      Element.prototype.animate = original;
    }
  });

  it("closes the menu on Escape", () => {
    auth.user = { id: 1, role: "SUPERVISOR_ADMIN" };
    open("/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Navigation layout" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("on a normal phone (under 600px) is one row of six with the short labels, and no layout dots", () => {
    auth.user = { id: 1, role: "SUPERVISOR_ADMIN" };
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("max-width: 599px"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      const { container } = open("/dashboard");
      expect(container.querySelectorAll(".ae-bottomnav-bar")).toHaveLength(1);
      expect(container.querySelectorAll(".ae-bottomnav-bar a")).toHaveLength(6);
      expect(container.querySelector(".ae-bottomnav")?.getAttribute("data-compact")).toBe("true");
      expect(screen.queryByRole("button", { name: "Navigation layout" })).toBeNull();
      expect(screen.getByRole("link", { name: "Consolidated" }).textContent).toBe("Stocks");
      expect(screen.getByRole("link", { name: "Dashboard" }).textContent).toBe("Home");
    } finally {
      window.matchMedia = original;
    }
  });
});
