import type { ReactNode } from "react";

/**
 * Card-style toolbar strip - the consistent home for a page's date/location
 * filters on one side and its action controls (CSV export/import, zoom) on
 * the other. Replaces a loose row of individually-bordered buttons floating
 * directly against the page background with one defined, bordered surface -
 * the same "toolbar" treatment used by every serious data-grid app.
 */
export function Toolbar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ae-toolbar ${className}`.trim()}>{children}</div>;
}

/// Groups a page's action controls (CSV tools, zoom) so they sit together
/// with a shared gap, ready to be separated from each other by a ToolbarDivider.
export function ToolbarControls({ children }: { children: ReactNode }) {
  return <div className="ae-toolbar-controls">{children}</div>;
}

/// A thin vertical hairline between two control groups (e.g. CSV tools and
/// zoom) so they read as distinct clusters instead of one undifferentiated
/// row of buttons.
export function ToolbarDivider() {
  return <div className="ae-toolbar-divider" />;
}
