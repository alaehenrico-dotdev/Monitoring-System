import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "../context/ThemeContext";
import { SettingsPage } from "./SettingsPage";

const auth = vi.hoisted(() => ({ role: "SUPERVISOR_ADMIN" as string }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, role: auth.role } }) }));
vi.mock("../components/PageHeader", () => ({ PageHeader: ({ subtitle }: { subtitle?: ReactNode }) => <p>{subtitle}</p> }));
// The admin tools make their own requests; only their presence matters here.
vi.mock("./DatabaseBackupPage", () => ({ DatabaseBackupPage: () => <div>backup tool</div> }));
vi.mock("./DataResetPage", () => ({ DataResetPage: () => <div>reset tool</div> }));
vi.mock("./UserPasswordsPage", () => ({ UserPasswordsPage: () => <div>passwords tool</div> }));

const root = document.documentElement;
const open = () =>
  render(
    <ThemeProvider>
      <SettingsPage />
    </ThemeProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("ae-theme", "light");
  auth.role = "SUPERVISOR_ADMIN";
});
afterEach(() => localStorage.clear());

describe("SettingsPage appearance", () => {
  it("opens on Appearance, with the current choices selected", () => {
    open();
    expect(screen.getByRole("tab", { name: "Appearance", selected: true })).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Light/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /Classic/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("switching the theme applies at once and is remembered", () => {
    open();
    fireEvent.click(screen.getByRole("radio", { name: /Enterprise/ }));
    expect(root.dataset.ui).toBe("enterprise");
    expect(localStorage.getItem("ae-ui")).toBe("enterprise");
    expect((screen.getByRole("radio", { name: /Enterprise/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("switching the color mode applies at once", () => {
    open();
    fireEvent.click(screen.getByRole("radio", { name: /Dark/ }));
    expect(root.dataset.theme).toBe("dark");
    expect(localStorage.getItem("ae-theme")).toBe("dark");
  });
});

describe("SettingsPage tabs by role", () => {
  it("gives an admin the admin tools as well", () => {
    open();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Appearance", "Backup & Restore", "Data Reset", "User Passwords"]);
    fireEvent.click(screen.getByRole("tab", { name: "Data Reset" }));
    expect(screen.getByText("reset tool")).toBeTruthy();
  });

  it.each(["ONLINE_ENCODER", "OFFLINE_ENCODER"])("shows a %s only Appearance, and none of the admin tools", (role) => {
    auth.role = role;
    open();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Appearance"]);
    expect(screen.queryByText(/tool$/)).toBeNull();
    expect(screen.getByText("How the app looks on this computer.")).toBeTruthy();
  });
});
