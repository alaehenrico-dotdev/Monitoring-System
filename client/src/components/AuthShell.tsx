import type { FormEvent, ReactNode } from "react";
import { LogoMark } from "./LogoMark";
import { TopBar } from "./TopBar";
import { colors, fonts } from "../theme";

/// The signed-out chrome shared by the Login page and the forced "choose your own
/// password" screen: charcoal backdrop, the animated logo, the wordmark, and the clock /
/// theme toggle in the corner (these screens have no page toolbar to carry them).
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "var(--ae-vh)",
          padding: "24px 16px",
          boxSizing: "border-box",
          fontFamily: fonts.body,
          background: colors.charcoal,
          backgroundImage: `radial-gradient(circle at 50% -10%, ${colors.charcoalSoft}, ${colors.charcoal} 70%)`,
        }}
      >
        <LogoMark size={104} />
        <h1
          style={{
            fontFamily: fonts.wordmark,
            fontSize: "calc(26px * var(--ae-fs, 1))",
            fontWeight: 800,
            color: colors.yellow,
            margin: "12px 0 2px",
          }}
        >
          Ala Eh!
        </h1>
        <p
          style={{
            fontSize: "calc(12.5px * var(--ae-fs, 1))",
            color: colors.cream,
            opacity: 0.8,
            margin: "0 0 24px",
            letterSpacing: 0.4,
            textAlign: "center",
          }}
        >
          Online &amp; Offline Stocks Monitoring System
        </p>
        {children}
      </div>
    </>
  );
}

/// The paper card on that backdrop, with the animated gold border. A <form> when given an
/// `onSubmit`, a plain block when the content brings its own form.
export function AuthCard({
  children,
  onSubmit,
  maxWidth = 320,
}: {
  children: ReactNode;
  onSubmit?: (e: FormEvent) => void;
  maxWidth?: number;
}) {
  const style = {
    width: "100%",
    maxWidth,
    boxSizing: "border-box",
    background: colors.paper,
    borderRadius: 6,
    padding: 24,
    // Positioning context for the 1px animated border sweep.
    position: "relative",
    boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
    color: colors.ink,
  } as const;
  const content = (
    <>
      <div aria-hidden className="ae-modal-border-sweep" style={{ padding: 0.5 }} />
      {children}
    </>
  );
  return onSubmit ? (
    <form onSubmit={onSubmit} style={style}>
      {content}
    </form>
  ) : (
    <div style={style}>{content}</div>
  );
}
