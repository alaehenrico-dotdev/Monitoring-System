import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { BackToTop } from "./BackToTop";
import { CursorAura } from "./CursorAura";
import { Toast, ToastHost } from "./Toast";
import { NavDrawerProvider } from "../context/NavDrawerContext";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { colors, fonts } from "../theme";

export function Layout() {
  const mainRef = useRef<HTMLElement>(null);
  const { online } = useOnlineStatus();
  const [offlineDismissed, setOfflineDismissed] = useState(false);
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
        <ToastHost />
        <BackToTop containerRef={mainRef} />
      </div>
    </NavDrawerProvider>
  );
}
