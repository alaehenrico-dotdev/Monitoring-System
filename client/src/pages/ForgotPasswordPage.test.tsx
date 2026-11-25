import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ForgotPasswordPage } from "./ForgotPasswordPage";
import { ApiError } from "../api/http";

const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => auth }));
const api = vi.hoisted(() => ({ resetPasswordWithCode: vi.fn(), requestResetEmail: vi.fn() }));
vi.mock("../api/auth", () => api);
const toast = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("../components/Toast", () => toast);
vi.mock("../components/TopBar", () => ({ TopBar: () => null }));
vi.mock("../components/LogoMark", () => ({ LogoMark: () => null }));

const GOOD = "tricycle-mango-lantern";
const open = () =>
  render(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/" element={<div>the app</div>} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Routes>
    </MemoryRouter>,
  );
// The Field labels are not tied to their inputs, so find the inputs by what they are.
const field = (c: HTMLElement, i: number) => c.querySelectorAll("input")[i] as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: "Set new password" }) as HTMLButtonElement;
function fill(c: HTMLElement, v: { username?: string; code?: string; next?: string }) {
  const values = [v.username ?? "ana", v.code ?? "ABCDE-FGHJK", v.next ?? GOOD];
  values.forEach((value, i) => fireEvent.change(field(c, i), { target: { value } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = null;
  api.resetPasswordWithCode.mockResolvedValue({ success: true });
});

describe("ForgotPasswordPage", () => {
  it("asks for the code in one short line", () => {
    open();
    expect(screen.getByText(/Enter the code you were given/)).toBeTruthy();
    expect(submit().disabled).toBe(true);
  });

  it("only enables the button once everything is filled in and the password is long enough", () => {
    const { container } = open();
    fill(container, { next: "short" });
    expect(submit().disabled).toBe(true);
    fill(container, {});
    expect(submit().disabled).toBe(false);
  });

  it("can show and hide the new password", () => {
    const { container } = open();
    expect(field(container, 2).type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(field(container, 2).type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(field(container, 2).type).toBe("password");
  });

  it("emails a code from the link beside the code field, then waits before offering it again", async () => {
    api.requestResetEmail.mockResolvedValue({ success: true, message: "If that administrator account has a verified recovery email, a code was sent to it." });
    const { container } = open();
    const link = () => screen.getByRole("button", { name: /Email me a code/ }) as HTMLButtonElement;
    expect(link().disabled).toBe(true); // needs a username first
    fireEvent.change(field(container, 0), { target: { value: " ana " } });
    fireEvent.click(link());
    await waitFor(() => expect(api.requestResetEmail).toHaveBeenCalledWith("ana"));
    expect((await screen.findByRole("status")).textContent).toMatch(/a code was sent/);
    expect(link().disabled).toBe(true);
    expect(link().textContent).toMatch(/\(\d+s\)/);
  });

  it("sends the username, code and new password, then goes to sign in with a notice", async () => {
    const { container } = open();
    fill(container, { username: " ana ", code: "abcde fghjk" });
    fireEvent.click(submit());
    await waitFor(() => expect(api.resetPasswordWithCode).toHaveBeenCalledWith("ana", "abcde fghjk", GOOD));
    expect(await screen.findByText("login page")).toBeTruthy();
    expect(toast.showToast).toHaveBeenCalledWith(expect.stringMatching(/Sign in with your new password/), "success");
  });

  it("shows the server's reason and stays on the page, so the person can fix it and retry", async () => {
    api.resetPasswordWithCode.mockRejectedValue(new ApiError(400, "That reset code is invalid or has expired. Ask your administrator for a new one."));
    const { container } = open();
    fill(container, {});
    fireEvent.click(submit());
    expect((await screen.findByRole("alert")).textContent).toMatch(/invalid or has expired/);
    expect(screen.queryByText("login page")).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it("has a way back to sign in", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(screen.getByText("login page")).toBeTruthy();
  });

  it("does not show to someone who is already signed in", () => {
    auth.user = { id: 1 };
    open();
    expect(screen.getByText("the app")).toBeTruthy();
  });
});
