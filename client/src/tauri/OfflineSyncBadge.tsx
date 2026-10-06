// Only ever reached via Layout.tsx's React.lazy() import, gated on
// import.meta.env.MODE === "tauri" - so this file (and its offlineStore/sync
// imports) never ends up in the plain web build's bundle, same reasoning as
// every other file under src/tauri/.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { sendQueuedWrite } from "../api/http";
import {
  flushPendingWrites,
  getPendingWriteCount,
  onPendingWritesChanged,
} from "./offlineStore";
import { useSyncEngine } from "./sync/useSyncEngine";
import { useSyncUiState } from "./sync/SyncStore";
import { colors } from "../theme";

/// Shows pending/conflict status for BOTH offline systems:
/// - the generic outbox (offlineStore.ts - unmirrored endpoints like
///   dashboard/reports), flushed on the browser's own reconnect event
/// - the structured sync engine (sync/ - Product/DailyOnlineStock/
///   DailyOfflineStock/ManualCount), which drives its own push+pull on
///   launch, reconnect, and a periodic idle interval (see useSyncEngine)
///
/// Appears whenever the desktop server is unreachable, sync needs attention,
/// or queued changes/conflicts remain. Healthy, fully synced sessions stay
/// out of the way.
export function OfflineSyncBadge() {
  const { reconnects } = useOnlineStatus();
  const [genericPendingCount, setGenericPendingCount] = useState(0);
  const {
    isReachable,
    pendingCount: syncPendingCount,
    conflictCount,
  } = useSyncEngine();
  const { syncing, failed, lastSyncedAt } = useSyncUiState();

  const refreshGenericPendingCount = useCallback(async () => {
    setGenericPendingCount(await getPendingWriteCount());
  }, []);

  useEffect(() => {
    void refreshGenericPendingCount();
    return onPendingWritesChanged(() => void refreshGenericPendingCount());
  }, [refreshGenericPendingCount]);

  useEffect(() => {
    // Deliberately also runs on mount (reconnects starts at 0, same as any
    // later reconnect) - not just on a live reconnect transition during this
    // session. Without this, a write queued while the app crashed/closed
    // while still online (so no offline->online transition ever happens in
    // the NEXT session, since it launches already online) would sit queued
    // indefinitely - the structured sync engine already flushes on launch
    // (useSyncEngine.ts) for the same reason.
    flushPendingWrites(sendQueuedWrite).then((result) => {
      if (result.rejected.length > 0) {
        // These were actively rejected by a reachable server (not a
        // connectivity failure) - most likely because whatever they were
        // staged against has since changed. This is the generic outbox
        // (unmirrored endpoints only) - it has no conflict-review UI of its
        // own the way the structured sync tables do, so this is logged
        // rather than silently dropped. The user's original entry is still
        // visible wherever they typed it (see usePendingEntryChanges).
        console.error(
          "Some offline-queued writes were rejected and dropped:",
          result.rejected,
        );
      }
      void refreshGenericPendingCount();
    });
  }, [reconnects, refreshGenericPendingCount]);

  const totalPending = genericPendingCount + syncPendingCount;
  if (
    isReachable &&
    totalPending === 0 &&
    conflictCount === 0 &&
    !syncing &&
    !failed
  )
    return null;

  const lastSyncLabel = lastSyncedAt
    ? `Last server sync ${new Date(lastSyncedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    : "Local data available · first server sync pending";
  let connectionLabel = "Connected";
  if (syncing) connectionLabel = "Syncing…";
  else if (!isReachable)
    connectionLabel = "Server unreachable · using saved data";
  else if (failed) connectionLabel = "Sync failed · tap Sync";

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        bottom: 56,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 150,
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "4px 10px",
        maxWidth: "calc(100vw - 24px)",
        padding: "8px 14px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        background: colors.charcoalRaised,
        color: colors.cream,
        border: `1px solid ${colors.gold}`,
        boxShadow: "0 6px 20px rgba(12, 12, 12, 0.35)",
      }}
    >
      <span>{connectionLabel}</span>
      {totalPending > 0 && <span>{totalPending} pending</span>}
      {!syncing && <span>{lastSyncLabel}</span>}
      {conflictCount > 0 && (
        <Link
          to="/sync-conflicts"
          style={{ color: colors.danger, textDecoration: "underline" }}
        >
          {conflictCount} conflict{conflictCount === 1 ? "" : "s"}
        </Link>
      )}
    </div>
  );
}
