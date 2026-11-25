import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyRecoveryEmail = vi.hoisted(() => vi.fn());
vi.mock("../api/auth", () => ({ verifyRecoveryEmail }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: null, refreshUser: vi.fn() }) }));
vi.mock("../components/AuthShell", () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AuthCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { VerifyEmailPage } from "./VerifyEmailPage";

const LINK = "/verify-email?token=abcdefghijklmnopqrstuvwxyz0123456789";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VerifyEmailPage", () => {
  it("spends the token exactly once even under StrictMode, then says it is confirmed", async () => {
    verifyRecoveryEmail.mockResolvedValue({ success: true });
    render(
      <StrictMode>
        <MemoryRouter initialEntries={[LINK]}>
          <VerifyEmailPage />
        </MemoryRouter>
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByText(/recovery email is confirmed/i)).toBeTruthy());
    expect(verifyRecoveryEmail).toHaveBeenCalledTimes(1);
    expect(verifyRecoveryEmail).toHaveBeenCalledWith("abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("shows the server's reason when the link is rejected", async () => {
    verifyRecoveryEmail.mockRejectedValue(new Error("This link is invalid or has expired."));
    render(
      <MemoryRouter initialEntries={[LINK]}>
        <VerifyEmailPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/invalid or has expired/));
  });
});
