import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  unauthorized: null as null | (() => void),
  unsaved: 0,
}));

vi.mock("../api/auth", () => ({
  changePassword: vi.fn(),
  getMe: mocks.getMe,
  login: vi.fn(),
  loginWithCode: vi.fn(),
  signOutEverywhere: vi.fn(),
}));
vi.mock("../api/http", () => ({
  // Same shape as the real class (api/http.ts): status first.
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  getToken: () => "token",
  setToken: vi.fn(),
  setUnauthorizedHandler: (fn: null | (() => void)) => {
    mocks.unauthorized = fn;
  },
}));
vi.mock("../utils/draftBackup", () => ({ parkDraftsForLogout: vi.fn(), restoreDraftBackup: () => 0 }));
vi.mock("../utils/unsavedWork", () => ({ countAllUnsavedWork: () => mocks.unsaved }));
vi.mock("../utils/rememberDevice", () => ({ isDeviceRemembered: () => false, saveDeviceChoice: vi.fn() }));

import { AuthProvider, useAuth } from "./AuthContext";
import { ApiError } from "../api/http";

const KEY = "ae:ai-chat:7";
const saveSomeChat = () => localStorage.setItem(KEY, JSON.stringify([{ id: "a", at: 1, question: "q", answer: "a", sources: [] }]));
const user = { id: 7, username: "u", name: "U", role: "SUPERVISOR_ADMIN" };

function Probe() {
  const auth = useAuth();
  return (
    <>
      <span>{auth.loading ? "loading" : auth.user ? "in" : "out"}</span>
      <button type="button" onClick={auth.logout}>
        Sign out
      </button>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.unauthorized = null;
  mocks.unsaved = 0;
});

describe("the header search's saved AI chat and signing out", () => {
  it("is wiped when the person logs out", async () => {
    mocks.getMe.mockResolvedValue(user);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("in");
    saveSomeChat();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByText("out");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("is wiped when the session expires and the person is sent to the login screen", async () => {
    mocks.getMe.mockResolvedValue(user);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("in");
    await waitFor(() => expect(mocks.unauthorized).not.toBeNull());
    saveSomeChat();
    act(() => mocks.unauthorized!());
    await screen.findByText("out");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("is kept while the person stays signed in, even through an expiry that keeps their unsaved edits on screen", async () => {
    mocks.getMe.mockResolvedValue(user);
    mocks.unsaved = 2; // unsaved edits: the page is kept and the password is asked for in place
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("in");
    await waitFor(() => expect(mocks.unauthorized).not.toBeNull());
    saveSomeChat();
    act(() => mocks.unauthorized!());
    expect(screen.getByText("in")).toBeTruthy();
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  it("is not touched just because nobody was signed in yet", async () => {
    // A page load with no session lands on the login screen: that is not a sign-out.
    saveSomeChat();
    mocks.getMe.mockRejectedValue(new ApiError(401, "Unauthorized"));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("out");
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });
});
