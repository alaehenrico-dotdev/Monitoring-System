import { useRef } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { BackToTop } from "./BackToTop";
import { NavDrawerProvider } from "../context/NavDrawerContext";
import { colors, fonts } from "../theme";

export function Layout() {
  const mainRef = useRef<HTMLElement>(null);

  return (
    // Sidebar is now a floating overlay only (no docked width to reserve),
    // opened from the logo button in each page's own PageHeader rather than
    // a trigger of its own - NavDrawerProvider is the shared open/close
    // state both of those need despite not being direct siblings (the
    // header is rendered deep inside <Outlet/>, not next to <Sidebar/>).
    <NavDrawerProvider>
      <div className="app-shell" style={{ fontFamily: fonts.body, height: "100vh", display: "flex", overflow: "hidden" }}>
        <Sidebar />

        <main
          ref={mainRef}
          className="ae-main"
          style={{ flex: 1, height: "100%", overflowX: "hidden", overflowY: "auto", background: colors.paper, color: colors.ink }}
        >
          <Outlet />
        </main>
        <BackToTop containerRef={mainRef} />
      </div>
    </NavDrawerProvider>
  );
}
