// Drives the sync engine: on app launch, whenever the configured server
// transitions from unreachable to reachable, and periodically while idle.
import { useEffect, useRef, useState } from "react";
import { registerSyncRunner, setSyncUiState } from "./SyncStore";
import { useServerConnectivity } from "./connectivity";
import { runSync } from "./engine";
import { countPendingSyncChanges, countUnresolvedConflicts } from "./localDb";

// Not the same interval as the connectivity health check (30s) - this is
// how often a full push+pull runs while the app sits idle and reachable, to
// pick up other clients' changes even without a reconnect event of its own.
const IDLE_SYNC_INTERVAL_MS = 60_000;

export function useSyncEngine() {
  const { isReachable, reconnects } = useServerConnectivity();
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const syncing = useRef(false);

  async function refreshCounts() {
    setPendingCount(await countPendingSyncChanges());
    setConflictCount(await countUnresolvedConflicts());
  }

  async function sync() {
    if (syncing.current) return;
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

  return { isReachable, pendingCount, conflictCount };
}
