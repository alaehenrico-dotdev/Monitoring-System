// Only ever reached via Layout.tsx's React.lazy() import, gated on
// import.meta.env.MODE === "tauri" - so this file (and its offlineStore/sync
// imports) never ends up in the plain web build's bundle, same reasoning as
// every other file under src/tauri/.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { sendQueuedWrite } from "../api/http";
import { flushPendingWrites, getPendingWriteCount } from "./offlineStore";
import { useSyncEngine } from "./sync/useSyncEngine";
import { colors } from "../theme";

/// Shows pending/conflict status for BOTH offline systems:
/// - the generic outbox (offlineStore.ts - unmirrored endpoints like
///   dashboard/reports), flushed on the browser's own reconnect event
/// - the structured sync engine (sync/ - Product/DailyOnlineStock/
///   DailyOfflineStock/ManualCount), which drives its own push+pull on
///   launch, reconnect, and a periodic idle interval (see useSyncEngine)
///
/// Renders nothing once both are empty - the plain "Offline - showing saved
/// data" banner in Layout.tsx already covers the no-pending-changes case.
export function OfflineSyncBadge() {
  const { reconnects } = useOnlineStatus();
  const [genericPendingCount, setGenericPendingCount] = useState(0);
  const { pendingCount: syncPendingCount, conflictCount } = useSyncEngine();

  useEffect(() => {
    getPendingWriteCount().then(setGenericPendingCount);
  }, []);

  useEffect(() => {
    if (reconnects === 0) return;
    flushPendingWrites(sendQueuedWrite).then((result) => {
      if (result.rejected.length > 0) {
        // These were actively rejected by a reachable server (not a
        // connectivity failure) - most likely because whatever they were
        // staged against has since changed. This is the generic outbox
        // (unmirrored endpoints only) - it has no conflict-review UI of its
        // own the way the structured sync tables do, so this is logged
        // rather than silently dropped. The user's original entry is still
        // visible wherever they typed it (see usePendingEntryChanges).
        console.error("Some offline-queued writes were rejected and dropped:", result.rejected);
      }
      getPendingWriteCount().then(setGenericPendingCount);
    });
  }, [reconnects]);

  const totalPending = genericPendingCount + syncPendingCount;
  if (totalPending === 0 && conflictCount === 0) return null;

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
        gap: 10,
        padding: "6px 14px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: colors.charcoalRaised,
        color: colors.cream,
        border: `1px solid ${colors.gold}`,
        boxShadow: "0 6px 20px rgba(12, 12, 12, 0.35)",
      }}
    >
      {totalPending > 0 && (
        <span>
          {totalPending} change{totalPending === 1 ? "" : "s"} waiting to sync
        </span>
      )}
      {conflictCount > 0 && (
        <Link to="/sync-conflicts" style={{ color: colors.danger, textDecoration: "underline" }}>
          {conflictCount} conflict{conflictCount === 1 ? "" : "s"} need review
        </Link>
      )}
    </div>
  );
}
