import { useRef } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { BackToTop } from "./BackToTop";
import { colors, fonts } from "../theme";

export function Layout() {
  const mainRef = useRef<HTMLElement>(null);

  return (
    // Fixed to the viewport height (not minHeight) with overflow hidden, so
    // the nav and main below are two independently-scrolling panes instead
    // of one flex row that stretches to match whichever side is taller.
    // Sidebar renders both the fixed, spring-animated rail itself and the
    // in-flow spacer that reserves its current width (see Sidebar.tsx) -
    // main just needs to be its normal flex sibling. Plain `<main>`, not a
    // `layout`-animated one: main's real width tracks the spacer's real
    // (animate-driven) width every frame already, which reads as one smooth
    // push. A `layout` FLIP here instead fakes the resize with a transform,
    // which visibly squishes the real content inside (grid text) while it
    // animates - a worse result than just letting it reflow for real.
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
  );
}
