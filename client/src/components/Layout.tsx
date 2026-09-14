import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { colors, fonts } from "../theme";

export function Layout() {
  return (
    // Fixed to the viewport height (not minHeight) with overflow hidden, so
    // the nav and main below are two independently-scrolling panes instead
    // of one flex row that stretches to match whichever side is taller.
    // Sidebar renders both the fixed, spring-animated rail itself and the
    // in-flow spacer that reserves its current width (see Sidebar.tsx) -
    // main just needs to be its normal flex sibling.
    <div className="app-shell" style={{ fontFamily: fonts.body, height: "100vh", display: "flex", overflow: "hidden" }}>
      <Sidebar />

      <main className="ae-main" style={{ flex: 1, height: "100%", overflow: "auto", background: colors.paper, color: colors.ink }}>
        <Outlet />
      </main>
    </div>
  );
}
