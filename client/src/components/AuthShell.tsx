import type { FormEvent, ReactNode } from "react";
import { LogoMark } from "./LogoMark";
import { TopBar } from "./TopBar";
import { colors, fonts } from "../theme";

/// The signed-out chrome shared by the Login page, the forgot-password page and the forced
/// "choose your own password" screen. On a wide screen it is split: a brand panel (the
/// animated logo, the wordmark, a one-line pitch) beside the form. On a phone it collapses to
/// a compact brand header over the form. The clock / theme toggle sit in the corner (these
/// screens have no page toolbar to carry them). Layout and theme-preset treatment live in
/// styles/toolbar-alignment.css (.ae-auth*), so each preset can restyle them.
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar />
      <div className="ae-auth" style={{ fontFamily: fonts.body }}>
        <aside className="ae-auth-brand">
          <div className="ae-auth-logo">
            <LogoMark size={104} />
          </div>
          <h1 className="ae-auth-wordmark" style={{ fontFamily: fonts.wordmark, color: colors.yellow }}>
            Ala Eh!
          </h1>
          <p className="ae-auth-system">Online &amp; Offline Stocks Monitoring System</p>
          <p className="ae-auth-pitch">Online and offline stock, per shift, audited.</p>
        </aside>
        <main className="ae-auth-main">{children}</main>
      </div>
    </>
  );
}

/// The card the form sits in. It carries the shared dialog classes (ae-modal-panel and the
/// border sweep), so every theme preset that restyles dialogs (radius, frame, shadow, glass)
/// restyles this card with no extra rules. A <form> when given an `onSubmit`, a plain block
/// when the content brings its own form. `title` / `subtitle` add the heading block.
export function AuthCard({
  children,
  onSubmit,
  maxWidth = 360,
  title,
  subtitle,
}: {
  children: ReactNode;
  onSubmit?: (e: FormEvent) => void;
  maxWidth?: number;
  title?: string;
  subtitle?: string;
}) {
  const props = { className: "ae-modal-panel ae-auth-card", style: { maxWidth } };
  const content = (
    <>
      <div aria-hidden className="ae-modal-border-sweep" style={{ padding: 0.5 }} />
      {title && (
        <div className="ae-auth-heading">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      )}
      {children}
    </>
  );
  return onSubmit ? (
    <form onSubmit={onSubmit} {...props}>
      {content}
    </form>
  ) : (
    <div {...props}>{content}</div>
  );
}
