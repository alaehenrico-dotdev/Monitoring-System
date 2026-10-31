import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LoginPage } from "./LoginPage";
import { forgetDevice, isDeviceRemembered, rememberedUsername, saveDeviceChoice } from "../utils/rememberDevice";

const auth = vi.hoisted(() => ({
  user: null,
  sessionError: null,
  login: vi.fn(),
  completeMfa: vi.fn(),
}));
vi.mock("../context/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../components/TopBar", () => ({ TopBar: () => null }));
vi.mock("../components/LogoMark", () => ({ LogoMark: () => null }));
vi.mock("../components/Spinner", () => ({ LoadingOverlay: () => null }));

const open = () =>
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
const usernameInput = (c: HTMLElement) => c.querySelector('input:not([type="password"]):not([type="checkbox"])') as HTMLInputElement;
const passwordInput = (c: HTMLElement) => c.querySelector('input[type="password"]') as HTMLInputElement;
const tick = () => screen.getByRole("checkbox") as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  auth.login.mockResolvedValue(null);
});

describe("remembered device storage", () => {
  it("keeps the username only while the device is remembered", () => {
    saveDeviceChoice(true, "ana");
    expect(isDeviceRemembered()).toBe(true);
    expect(rememberedUsername()).toBe("ana");
    saveDeviceChoice(false, "ana");
    expect(isDeviceRemembered()).toBe(false);
    expect(rememberedUsername()).toBe("");
    expect(localStorage.getItem("ala-eh-remembered-username")).toBeNull();
  });

  it("forgetting clears both, and never stores a password", () => {
    saveDeviceChoice(true, "ana");
    forgetDevice();
    expect(isDeviceRemembered()).toBe(false);
    expect(JSON.stringify({ ...localStorage })).not.toMatch(/password/i);
  });

  it("survives storage that throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(isDeviceRemembered()).toBe(false);
    expect(rememberedUsername()).toBe("");
    spy.mockRestore();
  });
});

describe("LoginPage forgot password", () => {
  it("links to the reset screen, and offers it only on the password step", () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<div>reset screen</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(screen.getByText("reset screen")).toBeTruthy();
  });
});

describe("LoginPage remember this device", () => {
  it("starts unticked with an empty username on a new device", () => {
    const { container } = open();
    expect(tick().checked).toBe(false);
    expect(usernameInput(container).value).toBe("");
    expect(screen.queryByText("Forget this device")).toBeNull();
  });

  it("sends the tick with the sign-in", async () => {
    const { container } = open();
    fireEvent.change(usernameInput(container), { target: { value: "ana" } });
    fireEvent.change(passwordInput(container), { target: { value: "pw" } });
    fireEvent.click(tick());
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(auth.login).toHaveBeenCalledWith("ana", "pw", true));
  });

  it("prefills the username and the tick on a remembered device", () => {
    saveDeviceChoice(true, "ana");
    const { container } = open();
    expect(usernameInput(container).value).toBe("ana");
    expect(tick().checked).toBe(true);
  });

  it("'Forget this device' clears the username, the tick and the stored choice", () => {
    saveDeviceChoice(true, "ana");
    const { container } = open();
    fireEvent.click(screen.getByText("Forget this device"));
    expect(usernameInput(container).value).toBe("");
    expect(tick().checked).toBe(false);
    expect(isDeviceRemembered()).toBe(false);
  });
});
