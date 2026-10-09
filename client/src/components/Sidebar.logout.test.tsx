import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { ENTRY_PREFIX } from "../utils/unsavedWork";

const logout = vi.hoisted(() => vi.fn());
const close = vi.hoisted(() => vi.fn());

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 1, username: "ana", name: "Ana Cruz", role: "ONLINE_ENCODER" },
    logout,
  }),
}));

vi.mock("../context/NavDrawerContext", () => ({
  useNavDrawer: () => ({ open: true, anchor: { top: 60, left: 20 }, close }),
}));

function stage(key: string, productIds: number[]) {
  sessionStorage.setItem(
    key,
    JSON.stringify(Object.fromEntries(productIds.map((id) => [id, { stockIn: 1 }]))),
  );
}

/// The account panel's trigger. Scoped by title because the confirm dialog
/// renders a second button with the same accessible name - which is correct
/// for a confirm step, but ambiguous to a bare role query.
const logOutButton = () => screen.getByTitle("Log out");
const dialog = () => within(screen.getByRole("dialog", { hidden: true }));
const confirmButton = () => dialog().getByRole("button", { name: "Log out" });
const cancelButton = () => dialog().getByRole("button", { name: "Cancel" });

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("Sidebar - logout confirmation", () => {
  it("does not log out on the first click", () => {
    render(<Sidebar />);
    fireEvent.click(logOutButton());

    expect(logout).not.toHaveBeenCalled();
    expect(screen.getByText("Log out?")).toBeTruthy();
  });

  it("logs out once confirmed", () => {
    render(<Sidebar />);
    fireEvent.click(logOutButton());
    fireEvent.click(confirmButton());

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("does not log out when cancelled", () => {
    render(<Sidebar />);
    fireEvent.click(logOutButton());
    fireEvent.click(cancelButton());

    expect(logout).not.toHaveBeenCalled();
    expect(screen.queryByText("Log out?")).toBeNull();
  });

  it("can be re-opened after cancelling", () => {
    render(<Sidebar />);
    fireEvent.click(logOutButton());
    fireEvent.click(cancelButton());
    fireEvent.click(logOutButton());

    expect(screen.getByText("Log out?")).toBeTruthy();
  });
});

describe("Sidebar - unsaved work warning", () => {
  it("names what would be discarded", () => {
    stage(`${ENTRY_PREFIX}online:2026-10-09:NIGHT`, [1, 2, 3]);
    render(<Sidebar />);
    fireEvent.click(logOutButton());

    expect(screen.getByText(/You have unsaved work/)).toBeTruthy();
    expect(screen.getByText(/Online Entry/)).toBeTruthy();
    expect(screen.getByText(/3 products on 2026-10-09 Night/)).toBeTruthy();
  });

  it("says nothing alarming when there is no unsaved work", () => {
    render(<Sidebar />);
    fireEvent.click(logOutButton());

    expect(screen.queryByText(/You have unsaved work/)).toBeNull();
    expect(screen.getByText(/sign in again/)).toBeTruthy();
  });

  it("clears staged edits on confirm, so they can't surface under the next user", () => {
    // logout() itself only drops the token - without this the next person to
    // sign in on this browser would find someone else's staged numbers
    // waiting in the grid, under their own name.
    const key = `${ENTRY_PREFIX}online:2026-10-09:NIGHT`;
    stage(key, [1, 2]);

    render(<Sidebar />);
    fireEvent.click(logOutButton());
    fireEvent.click(confirmButton());

    expect(sessionStorage.getItem(key)).toBeNull();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("keeps staged edits when the logout is cancelled", () => {
    const key = `${ENTRY_PREFIX}online:2026-10-09:NIGHT`;
    stage(key, [1, 2]);

    render(<Sidebar />);
    fireEvent.click(logOutButton());
    fireEvent.click(cancelButton());

    expect(sessionStorage.getItem(key)).not.toBeNull();
  });
});
