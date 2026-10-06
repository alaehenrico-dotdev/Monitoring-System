// Drives sync at launch, on reconnect, on server realtime events, and as an
// idle fallback.
import { useEffect, useRef, useState } from "react";
import { hydrateLastSyncedAt, registerSyncRunner, setSyncUiState } from "./SyncStore";
import { useServerConnectivity } from "./connectivity";
import { runSync } from "./engine";
import { countPendingSyncChanges, countUnresolvedConflicts, getLastSyncedAt } from "./localDb";
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
  const isReachableRef = useRef(isReachable);
  isReachableRef.current = isReachable;

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
    // A new attempt replaces the previous result immediately, so the header
    // button cannot keep showing a successful checkmark while it is syncing.
    setSyncUiState({ syncing: true, failed: false, succeeded: false });
    try {
      await runSync();
      const lastSyncedAt = await getLastSyncedAt();
      setSyncUiState({ failed: false, succeeded: true, lastSyncedAt: lastSyncedAt ? Date.parse(lastSyncedAt) : null });
    } catch (err) {
      setSyncUiState({ failed: true, succeeded: false });
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
    void getLastSyncedAt().then((value) => {
      hydrateLastSyncedAt(value ? Date.parse(value) : null);
    });
    void sync();
    const interval = setInterval(() => {
      if (isReachableRef.current) sync();
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
