import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";

const auth = vi.hoisted(() => ({ user: null as Record<string, unknown> | null, loading: false }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../pages/ForcedPasswordChange", () => ({ ForcedPasswordChange: () => <div>choose your password</div> }));

function open() {
  return render(
    <MemoryRouter initialEntries={["/secret"]}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/secret" element={<div>the app</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  it("sends a signed-out visitor to login", () => {
    auth.user = null;
    open();
    expect(screen.getByText("login page")).toBeTruthy();
  });

  it("shows the app to a signed-in user", () => {
    auth.user = { id: 1, role: "ENCODER" };
    open();
    expect(screen.getByText("the app")).toBeTruthy();
  });

  it("holds back the whole app until a required password change is done", () => {
    auth.user = { id: 1, role: "SUPERVISOR_ADMIN", mustChangePassword: true };
    open();
    expect(screen.getByText("choose your password")).toBeTruthy();
    expect(screen.queryByText("the app")).toBeNull();
  });
});
