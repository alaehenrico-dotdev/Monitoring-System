import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DesktopModeGate } from "./DesktopModeGate";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), logout: vi.fn() }));
vi.mock("../api/auth", () => ({ verifyPassword: mocks.verify }));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 7 }, logout: mocks.logout }),
}));

/// coarse: touch is the primary input; narrow: the phone layout width.
function setDevice({ coarse, narrow }: { coarse: boolean; narrow: boolean }) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width") ? narrow && coarse : coarse,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: coarse ? 5 : 0,
    configurable: true,
  });
}

const open = () =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<DesktopModeGate />}>
          <Route index element={<div>app</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  mocks.verify.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("DesktopModeGate", () => {
  it("lets a mouse/keyboard computer straight through", () => {
    setDevice({ coarse: false, narrow: false });
    open();
    expect(screen.getByText("app")).toBeTruthy();
  });

  it("does not prompt in the read-only phone view", () => {
    setDevice({ coarse: true, narrow: true });
    open();
    expect(screen.getByText("app")).toBeTruthy();
  });

  it("asks for confirmation, then the password, on a touch device in desktop mode", async () => {
    setDevice({ coarse: true, narrow: false });
    mocks.verify.mockResolvedValue({ success: true });
    open();
    expect(screen.queryByText("app")).toBeNull();
    fireEvent.click(screen.getByText("Continue to desktop mode"));
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByText("Unlock desktop mode"));
    await waitFor(() => expect(screen.getByText("app")).toBeTruthy());
    expect(mocks.verify).toHaveBeenCalledWith("secret");
    expect(sessionStorage.getItem("ae:desktop-mode-ok:7")).toBe("1");
  });

  it("stays locked and shows the error on a wrong password", async () => {
    setDevice({ coarse: true, narrow: false });
    mocks.verify.mockRejectedValue(new Error("Incorrect password"));
    open();
    fireEvent.click(screen.getByText("Continue to desktop mode"));
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByText("Unlock desktop mode"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Incorrect password",
      ),
    );
    expect(screen.queryByText("app")).toBeNull();
  });
});
