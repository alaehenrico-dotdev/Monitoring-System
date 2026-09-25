import { useRef, useState, type ReactNode } from "react";
import { HeaderExtras } from "./HeaderExtras";
import { ChevronIcon } from "./icons";
import { LogoMark } from "./LogoMark";
import { useNavDrawer } from "../context/NavDrawerContext";

const LOGO_SIZE = 36;
// Same hover-triggered spin cooldown the logo had inside the sidebar
// itself - so hovering back and forth doesn't restart the animation
// mid-spin.
const LOGO_SPIN_MS = 1100;

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /// Dashboard's own subtitle needs a distinct class (larger, theme-
  /// following text, from before every page shared this card) - everyone
  /// else just gets the card's plain default <p> styling.
  subtitleClassName?: string;
  /// The page's own Toolbar.
  children?: ReactNode;
}

/// The black, gold-bordered card every page opens with. Title always stays
/// visible; the subtitle + Toolbar collapse away to give the page below
/// more room - animated via a grid-rows transition on the wrapper (see
/// .ae-page-header-collapsible in index.css), so collapsing eases the
/// height down smoothly instead of the content just vanishing. The
/// subtitle/toolbar stay mounted either way (only the height + opacity of
/// their wrapper change) so the animation has something to transition.
/// The collapse toggle itself is a small tab straddling the card's bottom
/// border, centered - invisible until the header is hovered (see
/// .ae-page-header-collapse-btn in index.css), so it reads as a subtle
/// affordance on the edge rather than a permanent toolbar button. It
/// always renders (collapsed or not, hovered or not) so there's still a
/// way back once collapsed - hovering the collapsed header (title row
/// alone) reveals it again.
///
/// Collapse state is local to this mount (resets on navigating away and
/// back), not persisted - a page's Toolbar holds that page's actual
/// controls (Save, filters, CSV import), so silently opening some other
/// page already collapsed would hide functionality the user forgot they'd
/// hidden, instead of just chrome.
///
/// The header is the app's main container for controls and navigation now:
/// the brand logo (formerly the sidebar's own clickable header) sits at the
/// top-left beside the title/subtitle and opens the floating nav drawer
/// (Sidebar.tsx, via NavDrawerContext) instead of toggling the sidebar's
/// own long-gone docked/collapsed states.
export function PageHeader({ title, subtitle, subtitleClassName, children }: PageHeaderProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { open, toggle } = useNavDrawer();
  const [logoSpin, setLogoSpin] = useState(0);
  const lastSpinAtRef = useRef(0);
  const logoRef = useRef<HTMLButtonElement>(null);

  function spinLogo() {
    const now = performance.now();
    if (now - lastSpinAtRef.current < LOGO_SPIN_MS) return;
    lastSpinAtRef.current = now;
    setLogoSpin((n) => n + 1);
  }

  function handleLogoClick() {
    // Measured fresh on every click (not cached) - the logo's on-screen
    // position depends on this page's own header height (subtitle length,
    // whether it's collapsed, etc.), so a stale rect from an earlier
    // render could point the floating panel at the wrong spot.
    const rect = logoRef.current?.getBoundingClientRect();
    toggle({ top: (rect?.bottom ?? 60) + 8, left: rect?.left ?? 20 });
  }

  return (
    <div className={`ae-page-header${collapsed ? " ae-page-header--collapsed" : ""}`}>
      <HeaderExtras />
      <div className="ae-page-header-top">
        <button
          ref={logoRef}
          type="button"
          className="ae-page-header-logo no-print"
          onMouseEnter={spinLogo}
          onClick={handleLogoClick}
          aria-expanded={open}
          aria-label={open ? "Close navigation" : "Open navigation"}
          title={open ? "Close navigation" : "Open navigation"}
        >
          <LogoMark size={LOGO_SIZE} spin={logoSpin} />
        </button>
        <div className="ae-page-header-titles">
          <h2>{title}</h2>
          <div className="ae-page-header-collapsible">
            <div className="ae-page-header-collapsible-inner">
              {subtitle && <p className={subtitleClassName}>{subtitle}</p>}
              <div className="ae-page-header-toolbar-slot">{children}</div>
            </div>
          </div>
        </div>
      </div>
      <button
        type="button"
        className="ae-page-header-collapse-btn no-print"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand header" : "Collapse header"}
        title={collapsed ? "Expand header" : "Collapse header"}
      >
        <ChevronIcon />
      </button>
    </div>
  );
}