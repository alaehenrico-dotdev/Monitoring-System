import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionExpiredDialog } from "./SessionExpiredDialog";
import { ApiError } from "../api/http";

const auth = vi.hoisted(() => ({
  user: { id: 1, username: "ana", name: "Ana" },
  reauthenticate: vi.fn(),
  reauthenticateWithCode: vi.fn(),
  logoutKeepingDrafts: vi.fn(),
}));
vi.mock("../context/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../utils/unsavedWork", () => ({ countAllUnsavedWork: () => 2 }));
vi.mock("./Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

// The Field label is not tied to its input, so find the inputs by what they are.
const passwordInput = (c: HTMLElement) => c.querySelector('input[type="password"]') as HTMLInputElement | null;
const codeInput = () => screen.findByPlaceholderText(/recovery code/);
const submit = () => fireEvent.click(screen.getByRole("button", { name: /Sign in|Verify/ }));

beforeEach(() => vi.clearAllMocks());

describe("SessionExpiredDialog", () => {
  it("signs back in with just the password when the account has no second step", async () => {
    auth.reauthenticate.mockResolvedValue(null);
    const { container } = render(<SessionExpiredDialog />);
    fireEvent.change(passwordInput(container)!, { target: { value: "pw" } });
    submit();
    await waitFor(() => expect(auth.reauthenticate).toHaveBeenCalledWith("pw"));
    expect(auth.reauthenticateWithCode).not.toHaveBeenCalled();
  });

  it("asks for the code when the account uses two-step verification, then finishes with it", async () => {
    auth.reauthenticate.mockResolvedValue({ mfaToken: "half-way" });
    auth.reauthenticateWithCode.mockResolvedValue(undefined);
    const { container } = render(<SessionExpiredDialog />);
    fireEvent.change(passwordInput(container)!, { target: { value: "pw" } });
    submit();
    const code = await codeInput();
    expect(passwordInput(container)).toBeNull();
    fireEvent.change(code, { target: { value: "123456" } });
    submit();
    await waitFor(() => expect(auth.reauthenticateWithCode).toHaveBeenCalledWith("half-way", "123456"));
  });

  it("shows a wrong code's error and goes back to the password if the half-way sign-in ran out", async () => {
    auth.reauthenticate.mockResolvedValue({ mfaToken: "half-way" });
    auth.reauthenticateWithCode.mockRejectedValue(new ApiError(401, "That sign-in step expired - please sign in again."));
    const { container } = render(<SessionExpiredDialog />);
    fireEvent.change(passwordInput(container)!, { target: { value: "pw" } });
    submit();
    fireEvent.change(await codeInput(), { target: { value: "000000" } });
    submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/expired/);
    await waitFor(() => expect(passwordInput(container)).not.toBeNull());
  });
});
