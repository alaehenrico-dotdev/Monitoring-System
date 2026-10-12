import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { RealtimeProvider, useRealtimeVersion } from "./RealtimeContext";

vi.mock("./AuthContext", () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock("../api/http", () => ({ getToken: () => "t", getWsUrl: () => "ws://test/ws" }));

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send() {}
  close() {}
}

function Probe() {
  return <span data-testid="v">{useRealtimeVersion()}</span>;
}

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setVisibility("visible");
});

describe("RealtimeProvider - tab coming back to the foreground", () => {
  it("refetches (bumps the version) after the tab was hidden for a while", () => {
    render(
      <RealtimeProvider>
        <Probe />
      </RealtimeProvider>,
    );
    expect(screen.getByTestId("v").textContent).toBe("0");

    act(() => setVisibility("hidden"));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    act(() => setVisibility("visible"));

    expect(screen.getByTestId("v").textContent).toBe("1");
  });

  it("does not refetch for a brief tab switch", () => {
    render(
      <RealtimeProvider>
        <Probe />
      </RealtimeProvider>,
    );
    act(() => setVisibility("hidden"));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    act(() => setVisibility("visible"));
    expect(screen.getByTestId("v").textContent).toBe("0");
  });
});
