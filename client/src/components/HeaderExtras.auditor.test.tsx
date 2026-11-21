import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HeaderExtras } from "./HeaderExtras";

const auth = vi.hoisted(() => ({ role: "SUPERVISOR_ADMIN" as string }));
vi.mock("../context/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: 1, role: auth.role } }) }));
vi.mock("./LiveClock", () => ({ LiveClock: () => null }));
vi.mock("./QuickJump", () => ({ openQuickJump: vi.fn() }));
vi.mock("./AlertBell", () => ({ AlertBell: () => null }));
vi.mock("./ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("./TypingPractice", () => ({ TypingPractice: () => null }));
vi.mock("../hooks/useAiAvailable", () => ({ useAiAvailable: () => false }));
vi.mock("./Calculator", () => ({ HeaderCalculator: () => <button type="button">Calculator</button> }));

afterEach(cleanup);

describe("HeaderExtras and the calculator", () => {
  it("shows the header calculator to an admin", () => {
    auth.role = "SUPERVISOR_ADMIN";
    render(<HeaderExtras />);
    expect(screen.getByRole("button", { name: "Calculator" })).toBeTruthy();
  });

  it("leaves it out for an auditor, whose count page has its own in the toolbar (two would both answer Alt+C)", () => {
    auth.role = "AUDITOR";
    render(<HeaderExtras />);
    expect(screen.queryByRole("button", { name: "Calculator" })).toBeNull();
  });
});
