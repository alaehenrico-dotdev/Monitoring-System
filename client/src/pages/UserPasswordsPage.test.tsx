import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { UserPasswordsPage } from "./UserPasswordsPage";
import { ApiError } from "../api/http";

const api = vi.hoisted(() => ({ listAccounts: vi.fn(), setAccountPassword: vi.fn(), issueResetCode: vi.fn() }));
vi.mock("../api/users", () => api);
vi.mock("../components/Toast", () => ({ showToast: vi.fn() }));

const ACCOUNTS = [
  { id: 1, name: "Ana Cruz", username: "ana", role: "ONLINE_ENCODER", isActive: true },
  { id: 2, name: "Ben Reyes", username: "ben", role: "OFFLINE_ENCODER", isActive: false },
];
const dialog = () => screen.getByRole("dialog");

beforeEach(() => {
  vi.clearAllMocks();
  api.listAccounts.mockResolvedValue(ACCOUNTS);
});

describe("UserPasswordsPage - reset codes", () => {
  it("offers a reset code for active accounts only", async () => {
    render(<UserPasswordsPage />);
    await screen.findByText("Ana Cruz");
    expect(screen.getAllByRole("button", { name: "Set password" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Reset code" })).toHaveLength(1);
  });

  it("asks for the admin's password, then shows the code once with its expiry and how to use it", async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    api.issueResetCode.mockResolvedValue({ code: "ABCDE-FGHJK", expiresAt });
    render(<UserPasswordsPage />);
    await screen.findByText("Ana Cruz");
    fireEvent.click(screen.getByRole("button", { name: "Reset code" }));

    const create = within(dialog()).getByRole("button", { name: "Create reset code" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(dialog().querySelector('input[type="password"]') as HTMLInputElement, { target: { value: "my-admin-pw" } });
    fireEvent.click(create);

    await waitFor(() => expect(api.issueResetCode).toHaveBeenCalledWith(1, "my-admin-pw"));
    expect(await within(dialog()).findByText("ABCDE-FGHJK")).toBeTruthy();
    expect(within(dialog()).getByText(/30 minutes/)).toBeTruthy();
    expect(within(dialog()).getByText(/Forgot password\?/)).toBeTruthy();
    // The password field is gone, and a way to copy the code is offered.
    expect(dialog().querySelector('input[type="password"]')).toBeNull();
    expect(within(dialog()).getByRole("button", { name: "Copy" })).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a wrong admin password instead of a code", async () => {
    api.issueResetCode.mockRejectedValue(new ApiError(403, "Incorrect password"));
    render(<UserPasswordsPage />);
    await screen.findByText("Ana Cruz");
    fireEvent.click(screen.getByRole("button", { name: "Reset code" }));
    fireEvent.change(dialog().querySelector('input[type="password"]') as HTMLInputElement, { target: { value: "nope" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Create reset code" }));
    expect((await within(dialog()).findByRole("alert")).textContent).toBe("Incorrect password");
    expect(within(dialog()).queryByText(/ABCDE/)).toBeNull();
  });
});
