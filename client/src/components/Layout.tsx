import { lazy, Suspense, useRef } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { BackToTop } from "./BackToTop";
import { DownloadConfirmHost } from "./DownloadConfirm";
import { NavDrawerProvider } from "../context/NavDrawerContext";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { colors, fonts } from "../theme";

// Lazy + mode-gated so this (and its SQLite/DPAPI-backed offlineStore
// import) is only ever requested in the Tauri build - the web build's
// bundler never even emits the chunk, since isTauri is a build-time
// constant and the import() call site is unreachable when it's false.
const OfflineSyncBadge = lazy(() =>
  import("../tauri/OfflineSyncBadge").then((m) => ({
    default: m.OfflineSyncBadge,
  })),
);
const isTauri = import.meta.env.MODE === "tauri";

export function Layout() {
  const mainRef = useRef<HTMLElement>(null);
  const { online } = useOnlineStatus();

  return (
    // Sidebar is now a floating overlay only (no docked width to reserve),
    // opened from the logo button in each page's own PageHeader rather than
    // a trigger of its own - NavDrawerProvider is the shared open/close
    // state both of those need despite not being direct siblings (the
    // header is rendered deep inside <Outlet/>, not next to <Sidebar/>).
    <NavDrawerProvider>
      <div
        className="app-shell"
        style={{
          fontFamily: fonts.body,
          height: "100vh",
          display: "flex",
          overflow: "hidden",
        }}
      >
        <Sidebar />

        <main
          ref={mainRef}
          className="ae-main"
          // No background of its own: .app-shell paints the page color plus the
          // Ala Eh! seal watermark (see index.css), and this sits on top of both.
          style={{
            flex: 1,
            height: "100%",
            overflowX: "hidden",
            overflowY: "auto",
            color: colors.ink,
          }}
        >
          <Outlet />
        </main>
        {!online && (
          <div
            role="status"
            style={{
              position: "fixed",
              bottom: 16,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 150,
              padding: "8px 16px",
              borderRadius: 999,
              fontSize: 12.5,
              fontWeight: 600,
              background: colors.charcoalRaised,
              color: colors.cream,
              border: `1px solid ${colors.gold}`,
              boxShadow: "0 6px 20px rgba(12, 12, 12, 0.35)",
            }}
          >
            Offline - showing saved data. Edits stay on this device until you
            reconnect.
          </div>
        )}
        {isTauri && (
          <Suspense fallback={null}>
            <OfflineSyncBadge />
          </Suspense>
        )}
        <DownloadConfirmHost />
        <BackToTop containerRef={mainRef} />
      </div>
    </NavDrawerProvider>
  );
}
