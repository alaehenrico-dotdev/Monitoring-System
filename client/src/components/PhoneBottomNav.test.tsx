import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  it("lists every phone page for an admin, by its full name, with a short visible label", () => {
    auth.user = { id: 1, role: "SUPERVISOR_ADMIN" };
    open("/dashboard");

    expect(names()).toEqual(pagesForRole("SUPERVISOR_ADMIN", true).map((p) => p.label));
    expect(names()).toHaveLength(6);
    expect(screen.getByRole("link", { name: "Consolidated" }).textContent).toBe("Stocks");
    expect(screen.getByRole("link", { name: "Change Log" }).textContent).toBe("Log");
    expect(screen.getByRole("link", { name: "Dashboard" }).textContent).toBe("Home");
    expect(screen.getByRole("link", { name: "Settings" }).textContent).toBe("Settings");
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
});
