// Drives sync at launch, on reconnect, on server realtime events, and as an
// idle fallback.
import { useEffect, useRef, useState } from "react";
import { registerSyncRunner, setSyncUiState } from "./SyncStore";
import { useServerConnectivity } from "./connectivity";
import { runSync } from "./engine";
import { countPendingSyncChanges, countUnresolvedConflicts } from "./localDb";
import { useRealtimeVersion } from "../../context/RealtimeContext";

// How often a full push+pull runs while idle, to cover missed realtime events.
const IDLE_SYNC_INTERVAL_MS = 5 * 60_000;

export function useSyncEngine() {
  const { isReachable, reconnects } = useServerConnectivity();
  const realtimeVersion = useRealtimeVersion();
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const syncing = useRef(false);
  const syncAgain = useRef(false);

  async function refreshCounts() {
    setPendingCount(await countPendingSyncChanges());
    setConflictCount(await countUnresolvedConflicts());
  }

  async function sync() {
    if (syncing.current) {
      // Realtime/reconnect triggers can arrive while push+pull is in flight.
      // Remember one follow-up so a change arriving during that request is
      // not left waiting for the idle timer.
      syncAgain.current = true;
      return;
    }
    syncing.current = true;
    setSyncUiState({ syncing: true });
    try {
      await runSync();
      setSyncUiState({ failed: false, lastSyncedAt: Date.now() });
    } catch (err) {
      setSyncUiState({ failed: true });
      // Best effort - a failed sync attempt (most likely the server just
      // went unreachable again mid-sync) just means the next trigger tries
      // again; nothing staged offline is lost either way.
      console.error("Sync failed", err);
    } finally {
      syncing.current = false;
      setSyncUiState({ syncing: false });
      await refreshCounts();
      if (syncAgain.current) {
        syncAgain.current = false;
        void sync();
      }
    }
  }

  useEffect(() => {
    refreshCounts();
    sync(); // on launch
    const interval = setInterval(() => {
      if (isReachable) sync();
    }, IDLE_SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lets the header's Sync button (tauri/SyncButton.tsx) trigger this same
  // engine instead of running a second copy of it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => registerSyncRunner(sync), []);

  useEffect(() => {
    if (reconnects > 0) sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnects]);

  // Another client may have saved data on the server. The shared WebSocket
  // listener refreshes its pages and bumps this version; immediately pull the
  // new server state into the desktop app's SQLite mirror as well.
  useEffect(() => {
    if (realtimeVersion > 0 && isReachable) sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimeVersion, isReachable]);

  return { isReachable, pendingCount, conflictCount };
}
