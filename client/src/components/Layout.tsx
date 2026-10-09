import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { BackToTop } from "./BackToTop";
import { CursorAura } from "./CursorAura";
import { Toast, ToastHost } from "./Toast";
import { QuickJump } from "./QuickJump";
import { ConfirmDialog } from "./ConfirmDialog";
import { SessionExpiredDialog } from "./SessionExpiredDialog";
import { NavDrawerProvider } from "../context/NavDrawerContext";
import { useAuth } from "../context/AuthContext";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useUnsavedWorkGuard } from "../hooks/useUnsavedWorkGuard";
import { useSessionExpiryWatch } from "../hooks/useSessionExpiryWatch";
import { countAllUnsavedWork } from "../utils/unsavedWork";
import { colors, fonts } from "../theme";

export function Layout() {
  const mainRef = useRef<HTMLElement>(null);
  const { online } = useOnlineStatus();
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const {
    user,
    sessionExpired,
    expireSession,
    recoveredDrafts,
    dismissRecovered,
  } = useAuth();
  // Set (to the function that actually closes the window) when the desktop
  // app's close button is pressed with unsaved work - see useUnsavedWorkGuard.
  const [closePrompt, setClosePrompt] = useState<(() => void) | null>(null);
  useUnsavedWorkGuard(user?.id, (proceed) => setClosePrompt(() => proceed));
  const minutesLeft = useSessionExpiryWatch(
    user !== null && !sessionExpired,
    expireSession,
  );
  const [expiryWarnDismissed, setExpiryWarnDismissed] = useState(false);
  useEffect(() => {
    if (minutesLeft === null) setExpiryWarnDismissed(false);
  }, [minutesLeft]);
  // Show the offline notice again the next time the connection drops.
  useEffect(() => {
    if (online) setOfflineDismissed(false);
  }, [online]);

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
        <CursorAura />
        <Sidebar />
        {/* Ctrl+K from anywhere - mounted here, not per page, so the
            shortcut and the header's search button work on every route. */}
        <QuickJump />

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
        <Toast
          id="server-offline"
          message={
            !online && !offlineDismissed
              ? "Server unreachable. Reconnect before loading or saving data."
              : null
          }
          variant="warning"
          duration={null}
          onDismiss={() => setOfflineDismissed(true)}
        />
        <Toast
          id="session-expiring"
          message={
            minutesLeft !== null && !expiryWarnDismissed
              ? `Your session expires in about ${minutesLeft} min. Save your changes soon.`
              : null
          }
          variant="warning"
          duration={null}
          onDismiss={() => setExpiryWarnDismissed(true)}
        />
        <Toast
          id="drafts-recovered"
          message={
            recoveredDrafts > 0
              ? `Recovered your unsaved edits from last time (${recoveredDrafts} sheet${recoveredDrafts === 1 ? "" : "s"}). They aren't saved yet - open the entry page to review and save.`
              : null
          }
          variant="info"
          duration={null}
          onDismiss={dismissRecovered}
        />
        {sessionExpired && <SessionExpiredDialog />}
        {closePrompt && (
          <ConfirmDialog
            title="Close with unsaved changes?"
            confirmLabel="Close anyway"
            onCancel={() => setClosePrompt(null)}
            onConfirm={() => {
              closePrompt();
              setClosePrompt(null);
            }}
          >
            You have {countAllUnsavedWork()} unsaved change
            {countAllUnsavedWork() === 1 ? "" : "s"} that haven't been saved to
            the server. They're backed up on this computer and will come back
            the next time you sign in, but nobody else can see them until you
            save.
          </ConfirmDialog>
        )}
        <ToastHost />
        <BackToTop containerRef={mainRef} />
      </div>
    </NavDrawerProvider>
  );
}
