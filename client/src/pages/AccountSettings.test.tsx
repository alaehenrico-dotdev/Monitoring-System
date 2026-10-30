import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AccountSettings } from "./AccountSettings";

const auth = vi.hoisted(() => ({
  user: { id: 1, username: "ana", name: "Ana Cruz", role: "SUPERVISOR_ADMIN", mfaEnabled: false } as Record<string, unknown>,
  signOutEverywhere: vi.fn(),
  refreshUser: vi.fn(),
  changeOwnPassword: vi.fn(),
}));
vi.mock("../context/AuthContext", () => ({ useAuth: () => auth }));
const api = vi.hoisted(() => ({ startMfaSetup: vi.fn(), enableMfa: vi.fn(), disableMfa: vi.fn() }));
vi.mock("../api/auth", () => api);
vi.mock("../components/QrCode", () => ({ QrCode: () => <div>qr</div> }));
vi.mock("../components/Toast", () => ({ showToast: vi.fn() }));

const dialog = () => screen.queryByRole("dialog");
const passwordInput = () => dialog()!.querySelector('input[type="password"]') as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 1, username: "ana", name: "Ana Cruz", role: "SUPERVISOR_ADMIN", mfaEnabled: false };
  auth.signOutEverywhere.mockResolvedValue(undefined);
  auth.refreshUser.mockResolvedValue(undefined);
});

describe("AccountSettings", () => {
  it("shows who is signed in and the three settings as cards", () => {
    render(<AccountSettings />);
    expect(screen.getByText("Ana Cruz")).toBeTruthy();
    expect(screen.getByText("AC")).toBeTruthy();
    expect(screen.getByText("SUPERVISOR ADMIN")).toBeTruthy();
    for (const title of ["Password", "Two-step verification", "Signed-in devices"]) expect(screen.getByText(title)).toBeTruthy();
  });

  it("opens the change-password form in a dialog and closes it with the X", () => {
    render(<AccountSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(dialog()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(dialog()).toBeNull();
  });

  it("says whether two-step is on, and offers the matching action", () => {
    const { unmount } = render(<AccountSettings />);
    expect(screen.getByText("Off")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
    unmount();
    auth.user = { ...auth.user, mfaEnabled: true };
    render(<AccountSettings />);
    expect(screen.getByText("On")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeTruthy();
  });

  it("walks through setup: password, scan and confirm, then recovery codes that cannot be dismissed by accident", async () => {
    api.startMfaSetup.mockResolvedValue({ secret: "ABCDEFGHIJKLMNOP", otpauthUrl: "otpauth://totp/x" });
    api.enableMfa.mockResolvedValue({ recoveryCodes: ["AAAAA-BBBBB", "CCCCC-DDDDD"] });
    render(<AccountSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));

    fireEvent.change(passwordInput(), { target: { value: "my-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(api.startMfaSetup).toHaveBeenCalledWith("my-password"));
    expect(await screen.findByText("qr")).toBeTruthy();
    expect(screen.getByText("ABCD EFGH IJKL MNOP")).toBeTruthy();

    const turnOn = screen.getByRole("button", { name: "Turn on" }) as HTMLButtonElement;
    expect(turnOn.disabled).toBe(true);
    fireEvent.change(screen.getByRole("dialog").querySelector("input") as HTMLInputElement, { target: { value: "123 456" } });
    fireEvent.click(turnOn);
    await waitFor(() => expect(api.enableMfa).toHaveBeenCalledWith("123 456"));
    expect(await screen.findByText("AAAAA-BBBBB")).toBeTruthy();
    expect(auth.refreshUser).toHaveBeenCalled();

    // The codes are shown once: Escape and a click outside must not close this step.
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("presentation"));
    expect(dialog()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I have saved them" }));
    expect(dialog()).toBeNull();
  });

  it("shows a wrong password instead of moving on", async () => {
    api.startMfaSetup.mockRejectedValue(new Error("Incorrect password"));
    render(<AccountSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    fireEvent.change(passwordInput(), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Incorrect password");
    expect(screen.queryByText("qr")).toBeNull();
  });

  it("turns two-step off with the password and a code", async () => {
    auth.user = { ...auth.user, mfaEnabled: true };
    api.disableMfa.mockResolvedValue({ success: true });
    render(<AccountSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    fireEvent.change(passwordInput(), { target: { value: "pw" } });
    fireEvent.change(dialog()!.querySelector('input:not([type="password"])') as HTMLInputElement, { target: { value: "654321" } });
    // The card and the dialog both have a "Turn off" button; the dialog's is the submit.
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(api.disableMfa).toHaveBeenCalledWith("pw", "654321"));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(auth.refreshUser).toHaveBeenCalled();
  });

  it("signs out the other devices", async () => {
    render(<AccountSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out everywhere else" }));
    await waitFor(() => expect(auth.signOutEverywhere).toHaveBeenCalledTimes(1));
  });
});
