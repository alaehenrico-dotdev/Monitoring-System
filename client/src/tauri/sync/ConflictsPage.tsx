// Desktop-only (see src/tauri/ - lazy-imported from App.tsx the same way
// every other page is, so it still gets its own chunk in the web build, but
// that chunk is simply never requested there since nothing links to it).
import { useEffect, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { Button } from "../../components/ui";
import { TableSkeleton } from "../../components/Skeleton";
import { colors, fonts } from "../../theme";
import { TABLE_LABELS } from "../../config/changeLog";
import { listUnresolvedConflicts, resolveConflict, stageManualCount } from "./localDb";
import type { ManualCountCache, SyncConflict } from "./types";

function isManualCountConflict(c: SyncConflict): boolean {
  return c.tableName === "manual_counts";
}

export function ConflictsPage() {
  const [conflicts, setConflicts] = useState<SyncConflict[] | null>(null);

  async function reload() {
    setConflicts(await listUnresolvedConflicts());
  }

  useEffect(() => {
    reload();
  }, []);

  async function acknowledge(c: SyncConflict) {
    await resolveConflict(c.id);
    await reload();
  }

  async function keepMine(c: SyncConflict) {
    const server = c.serverValue as ManualCountCache;
    await stageManualCount(c.productId, c.entryDate, c.shift, c.location!, server.systemRemainingStock, c.mineValue as number);
    await resolveConflict(c.id);
    await reload();
  }

  async function keepServer(c: SyncConflict) {
    // cache already holds the server's value (from the pull that ran
    // alongside this conflict being recorded) - nothing to re-stage.
    await resolveConflict(c.id);
    await reload();
  }

  return (
    <>
      <PageHeader
        title="Sync Conflicts"
        subtitle="Changes made offline that couldn't be automatically merged with the server. Nothing here was lost - review each one below."
      />
      <div style={{ padding: "0 16px 24px", maxWidth: 900, margin: "0 auto" }}>
        {conflicts === null ? (
          <TableSkeleton headers={["Conflict"]} rows={3} />
        ) : conflicts.length === 0 ? (
          <p style={{ fontFamily: fonts.body, color: colors.ink, opacity: 0.7, textAlign: "center", padding: 40 }}>
            No conflicts waiting for review.
          </p>
        ) : (
          conflicts.map((c) => (
            <div
              key={c.id}
              style={{
                background: colors.paper,
                borderRadius: 8,
                padding: 16,
                marginBottom: 12,
                border: `1px solid ${colors.gold}`,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {TABLE_LABELS[c.tableName] ?? c.tableName} - product #{c.productId}, {c.entryDate} ({c.shift}
                {c.location ? `, ${c.location}` : ""})
              </div>
              <div style={{ fontSize: 13, color: colors.ink, opacity: 0.8, marginBottom: 10 }}>
                {isManualCountConflict(c) ? (
                  <>
                    You counted <strong>{String(c.mineValue)}</strong> offline, but the server's count is now{" "}
                    <strong>{String((c.serverValue as ManualCountCache).manualCount)}</strong> (changed by someone else since you
                    last synced). Pick which one should stand.
                  </>
                ) : (
                  <>This change couldn't be applied: {c.reason}</>
                )}
              </div>

              {isManualCountConflict(c) ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <Button onClick={() => keepMine(c)}>Keep mine ({String(c.mineValue)})</Button>
                  <Button onClick={() => keepServer(c)}>Keep server's ({String((c.serverValue as ManualCountCache).manualCount)})</Button>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 13, color: colors.danger, marginBottom: 8 }}>
                    This couldn't be saved as-is - go re-enter it on the live grid once you're back online, with the current
                    numbers in front of you.
                  </p>
                  <Button onClick={() => acknowledge(c)}>Acknowledge</Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}
