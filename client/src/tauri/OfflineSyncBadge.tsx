// Only ever reached via Layout.tsx's React.lazy() import, gated on
// import.meta.env.MODE === "tauri" - so this file (and its offlineStore/http
// imports) never ends up in the plain web build's bundle, same reasoning as
// every other file under src/tauri/.
import { useEffect, useState } from "react";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { sendQueuedWrite } from "../api/http";
import { flushPendingWrites, getPendingWriteCount } from "./offlineStore";
import { colors } from "../theme";

/// Shows how many offline-queued writes are waiting to sync, and flushes the
/// outbox whenever useOnlineStatus reports a reconnect. Renders nothing once
/// the queue is empty - the plain "Offline - showing saved data" banner in
/// Layout.tsx already covers the no-pending-writes case for both builds.
export function OfflineSyncBadge() {
  const { reconnects } = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    getPendingWriteCount().then(setPendingCount);
  }, []);

  useEffect(() => {
    if (reconnects === 0) return;
    flushPendingWrites(sendQueuedWrite).then((result) => {
      if (result.rejected.length > 0) {
        // These were actively rejected by a reachable server (not a
        // connectivity failure) - most likely because whatever they were
        // staged against has since changed. Logged for now rather than a
        // full conflict-resolution UI, which is a larger follow-up; the
        // user's original entry is still visible wherever they typed it
        // (see usePendingEntryChanges), so nothing is silently lost.
        console.error("Some offline-queued writes were rejected and dropped:", result.rejected);
      }
      getPendingWriteCount().then(setPendingCount);
    });
  }, [reconnects]);

  if (pendingCount === 0) return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        bottom: 56,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 150,
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
      {pendingCount} change{pendingCount === 1 ? "" : "s"} waiting to sync
    </div>
  );
}
