import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HomeRedirect, PhoneGate } from "./PhoneGate";
import { isPhonePage, pagesForRole, phoneHomeFor } from "../config/navigation";

const auth = vi.hoisted(() => ({ user: { id: 1, role: "SUPERVISOR_ADMIN" } as Record<string, unknown> | null }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => auth }));

function setPhone(on: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: on,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<PhoneGate />}>
          <Route index element={<HomeRedirect />} />
          <Route path="/online" element={<div>online grid</div>} />
          <Route path="/dashboard" element={<div>dashboard</div>} />
          <Route path="/daily-report" element={<div>daily report</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  localStorage.clear();
  auth.user = { id: 1, role: "SUPERVISOR_ADMIN" };
});

describe("phone view", () => {
  it("sends a phone away from an entry grid to the dashboard (admin)", () => {
    setPhone(true);
    open("/online");
    expect(screen.getByText("dashboard")).toBeTruthy();
  });

  it("sends an encoder's phone to the daily report", () => {
    setPhone(true);
    auth.user = { id: 2, role: "ENCODER" };
    open("/online");
    expect(screen.getByText("daily report")).toBeTruthy();
  });

  it("opens the entry grid on a computer, and from /", () => {
    setPhone(false);
    open("/online");
    expect(screen.getByText("online grid")).toBeTruthy();
  });

  it("lands / on the entry grid on a computer and the dashboard on a phone", () => {
    setPhone(false);
    const { unmount } = open("/");
    expect(screen.getByText("online grid")).toBeTruthy();
    unmount();
    setPhone(true);
    open("/");
    expect(screen.getByText("dashboard")).toBeTruthy();
  });

  it("?phone=1 forces the phone view on a computer", () => {
    setPhone(false);
    window.history.pushState({}, "", "/?phone=1");
    open("/online");
    expect(screen.getByText("dashboard")).toBeTruthy();
    window.history.pushState({}, "", "/");
  });
});

describe("phone page list", () => {
  it("is an allow-list of read-only pages", () => {
    expect(isPhonePage("/dashboard")).toBe(true);
    expect(isPhonePage("/online")).toBe(false);
    expect(isPhonePage("/manual-count")).toBe(false);
    expect(phoneHomeFor("ENCODER")).toBe("/daily-report");
    expect(pagesForRole("SUPERVISOR_ADMIN", true).map((p) => p.to).sort()).toEqual(["/change-log", "/daily-out", "/daily-report", "/dashboard", "/settings", "/total-stocks"]);
  });
});
