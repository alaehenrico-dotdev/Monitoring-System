import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  role: "SUPERVISOR_ADMIN" as string | undefined,
  phone: false,
  getAiStatus: vi.fn(),
}));
vi.mock("../api/ai", () => ({ getAiStatus: mocks.getAiStatus }));
vi.mock("../context/AuthContext", () => ({ useOptionalAuth: () => (mocks.role ? { user: { role: mocks.role } } : null) }));
vi.mock("./useReadOnlyPhone", () => ({ useReadOnlyPhone: () => mocks.phone }));

import { resetAiAvailableCache, useAiAvailable } from "./useAiAvailable";

beforeEach(() => {
  vi.clearAllMocks();
  resetAiAvailableCache();
  mocks.role = "SUPERVISOR_ADMIN";
  mocks.phone = false;
  mocks.getAiStatus.mockResolvedValue({ enabled: true, model: "m", windows: [] });
});

describe("useAiAvailable", () => {
  it("is true for a supervisor on a server with a key", async () => {
    const { result } = renderHook(() => useAiAvailable());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("is false when the server has no key", async () => {
    mocks.getAiStatus.mockResolvedValue({ enabled: false, model: null, windows: [] });
    const { result } = renderHook(() => useAiAvailable());
    await waitFor(() => expect(mocks.getAiStatus).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("never even asks for an encoder or a signed-out screen", async () => {
    mocks.role = "ONLINE_ENCODER";
    expect(renderHook(() => useAiAvailable()).result.current).toBe(false);
    mocks.role = undefined;
    expect(renderHook(() => useAiAvailable()).result.current).toBe(false);
    expect(mocks.getAiStatus).not.toHaveBeenCalled();
  });

  it("is true on the phone view too", async () => {
    mocks.phone = true;
    const { result } = renderHook(() => useAiAvailable());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("retries after a failed status check instead of staying off for the session", async () => {
    mocks.getAiStatus.mockRejectedValueOnce(new Error("offline"));
    const first = renderHook(() => useAiAvailable());
    await waitFor(() => expect(mocks.getAiStatus).toHaveBeenCalledTimes(1));
    expect(first.result.current).toBe(false);
    const second = renderHook(() => useAiAvailable());
    await waitFor(() => expect(second.result.current).toBe(true));
  });
});

describe("the header search button", () => {
  it("is AI-styled only when the AI is available", async () => {
    const aiOn = { value: false };
    vi.resetModules();
    vi.doMock("./useAiAvailable", () => ({ useAiAvailable: () => aiOn.value }));
    vi.doMock("../components/LiveClock", () => ({ LiveClock: () => null }));
    vi.doMock("../components/ThemeToggle", () => ({ ThemeToggle: () => null }));
    vi.doMock("../components/TypingPractice", () => ({ TypingPractice: () => null }));
    vi.doMock("../components/AlertBell", () => ({ AlertBell: () => null }));
    vi.doMock("../components/Calculator", () => ({ HeaderCalculator: () => null }));
    vi.doMock("../components/QuickJump", () => ({ openQuickJump: vi.fn() }));
    vi.doMock("./useReadOnlyPhone", () => ({ useReadOnlyPhone: () => false }));
    const { HeaderExtras } = await import("../components/HeaderExtras");

    const plain = render(<HeaderExtras />);
    expect(screen.getByRole("button").className).toBe("ae-header-search-btn");
    expect(plain.container.querySelector(".ae-ai-spark")).toBeNull();
    plain.unmount();

    aiOn.value = true;
    const styled = render(<HeaderExtras />);
    expect(screen.getByRole("button").className).toContain("ae-header-search-btn--ai");
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("ask AI");
    expect(styled.container.querySelector(".ae-ai-spark")).not.toBeNull();
  });
});
