import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { RealtimeProvider, useRealtimeVersion } from "./RealtimeContext";
import { subscribeNotices, type AppNotice } from "../utils/notify";

vi.mock("./AuthContext", () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock("../api/http", () => ({ getToken: () => "t", getWsUrl: () => "ws://test/ws" }));

const sockets: FakeSocket[] = [];
class FakeSocket {
  constructor() {
    sockets.push(this);
  }
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

describe("RealtimeProvider - notices from the server", () => {
  const send = (payload: unknown) => act(() => sockets[sockets.length - 1].onmessage?.({ data: JSON.stringify(payload) }));

  it("turns a server notice into a toast, without refetching anything", () => {
    const seen: AppNotice[] = [];
    const off = subscribeNotices((n) => seen.push(n));
    render(
      <RealtimeProvider>
        <Probe />
      </RealtimeProvider>,
    );
    send({ type: "notice", level: "success", message: "Google Drive backup saved: a.sql.gz (3.0 MB)." });
    send({ type: "notice", level: "error", message: "The scheduled Google Drive backup failed: Quota exceeded" });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(seen).toEqual([
      { level: "success", message: "Google Drive backup saved: a.sql.gz (3.0 MB)." },
      { level: "error", message: "The scheduled Google Drive backup failed: Quota exceeded" },
    ]);
    expect(screen.getByTestId("v").textContent).toBe("0");
    off();
  });

  it("ignores a notice with no message, and treats an unknown level as a success", () => {
    const seen: AppNotice[] = [];
    const off = subscribeNotices((n) => seen.push(n));
    render(
      <RealtimeProvider>
        <Probe />
      </RealtimeProvider>,
    );
    send({ type: "notice", level: "error" });
    send({ type: "notice", level: "weird", message: "Hello" });
    expect(seen).toEqual([{ level: "success", message: "Hello" }]);
    off();
  });
});
