import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ForgotPasswordPage } from "./ForgotPasswordPage";
import { ApiError } from "../api/http";

const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => auth }));
const api = vi.hoisted(() => ({ resetPasswordWithCode: vi.fn() }));
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
function fill(c: HTMLElement, v: { username?: string; code?: string; next?: string; confirm?: string }) {
  const values = [v.username ?? "ana", v.code ?? "ABCDE-FGHJK", v.next ?? GOOD, v.confirm ?? v.next ?? GOOD];
  values.forEach((value, i) => fireEvent.change(field(c, i), { target: { value } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = null;
  api.resetPasswordWithCode.mockResolvedValue({ success: true });
});

describe("ForgotPasswordPage", () => {
  it("explains that an administrator issues the code", () => {
    open();
    expect(screen.getByText(/Ask your administrator for a reset code/)).toBeTruthy();
    expect(submit().disabled).toBe(true);
  });

  it("only enables the button once everything is filled in, long enough, and matching", () => {
    const { container } = open();
    fill(container, { next: "short" });
    expect(submit().disabled).toBe(true);
    fill(container, { next: GOOD, confirm: "something-different-1" });
    expect(submit().disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/don't match/);
    fill(container, {});
    expect(submit().disabled).toBe(false);
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
