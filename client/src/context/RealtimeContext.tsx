import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getToken, getWsUrl } from "../api/http";
import { useAuth } from "./AuthContext";

const BASE_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;
// A "Save All" across many cells fires many individual writes in quick
// succession - debouncing here means every page that cares gets one refetch
// per burst instead of one per cell.
const VERSION_DEBOUNCE_MS = 400;

const RealtimeContext = createContext<number>(0);

/**
 * Owns the single WebSocket connection for the whole app and republishes
 * "something changed" as a version number pages already fold into their own
 * fetch effects' dependency arrays (see useRealtimeVersion). Only connects
 * once a user is logged in and reconnects with backoff if the connection
 * drops.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!user) return;

    let closedByEffect = false;
    let socket: WebSocket | null = null;
    let hasConnected = false;
    let reconnectDelay = BASE_RECONNECT_MS;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      socket = new WebSocket(getWsUrl());

      socket.onopen = () => {
        if (closedByEffect) return;
        reconnectDelay = BASE_RECONNECT_MS;
        socket?.send(JSON.stringify({ type: "auth", token: getToken() }));
        // A disconnect may have hidden server changes while the socket was
        // down. Refetch tables as soon as it returns.
        if (hasConnected) setVersion((v) => v + 1);
        hasConnected = true;
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg?.type !== "data-changed") return;
        } catch {
          return;
        }
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => setVersion((v) => v + 1), VERSION_DEBOUNCE_MS);
      };

      socket.onclose = () => {
        if (closedByEffect) return;
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
      };
    }
    connect();

    return () => {
      closedByEffect = true;
      clearTimeout(reconnectTimer);
      clearTimeout(debounceTimer);
      socket?.close();
    };
  }, [user]);

  return <RealtimeContext.Provider value={version}>{children}</RealtimeContext.Provider>;
}

/** A number that increments whenever the server reports a data change - add it to a fetch effect's dependency array to keep that page live. */
export function useRealtimeVersion(): number {
  return useContext(RealtimeContext);
}
