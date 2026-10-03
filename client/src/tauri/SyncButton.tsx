// Header sync button for the desktop app. Only ever reached via
// HeaderExtras.tsx's React.lazy() import, gated on MODE === "tauri", so it
// stays out of the web build like everything else under src/tauri/.
import { useCursorGlow, CursorGlowOverlay } from "../components/CursorGlow";
import { SyncIcon } from "../components/icons";
import { requestSync, useSyncUiState } from "./sync/SyncStore";

function describe(
  syncing: boolean,
  failed: boolean,
  lastSyncedAt: number | null,
): string {
  if (syncing) return "Syncing…";
  if (failed) return "Last sync failed - click to retry";
  if (lastSyncedAt) {
    const time = new Date(lastSyncedAt).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `Sync now (last synced ${time})`;
  }
  return "Sync now";
}

export default function SyncButton() {
  const { syncing, failed, lastSyncedAt } = useSyncUiState();
  const {
    hostRef,
    gradientRef,
    spotlightRef,
    handlePointerMove,
    handlePointerLeave,
  } = useCursorGlow<HTMLButtonElement>();
  const label = describe(syncing, failed, lastSyncedAt);

  return (
    <button
      ref={hostRef}
      type="button"
      onClick={() => void requestSync()}
      onMouseMove={handlePointerMove}
      onMouseLeave={(e) => {
        handlePointerLeave();
        e.currentTarget.style.transform = "scale(1)";
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.92)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      disabled={syncing}
      title={label}
      aria-label={label}
      aria-busy={syncing}
      className="no-print ae-tap-target ae-sync-btn"
      style={{
        position: "relative",
        width: 36,
        height: 36,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: "0.5px solid transparent",
        background: "var(--ae-surface)",
        color: failed ? "var(--ae-danger-text)" : "var(--ae-text)",
        cursor: syncing ? "progress" : "pointer",
        boxShadow: "0 1px 4px rgba(12, 12, 12,0.15)",
        transition:
          "background-color 120ms ease, color 120ms ease, transform 120ms ease",
      }}
    >
      <CursorGlowOverlay
        gradientRef={gradientRef}
        spotlightRef={spotlightRef}
        borderWidth={0.5}
        spotlightRadius={40}
      />
      <span
        className={syncing ? "ae-sync-spin" : undefined}
        style={{ display: "flex" }}
      >
        <SyncIcon />
      </span>
    </button>
  );
}
