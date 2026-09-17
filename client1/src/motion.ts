import type { Transition } from "motion/react";

/// Shared spring config for the sidebar's own rail/spacer resize (Sidebar.tsx)
/// and Layout.tsx's `<main>` `layout` animation - both need to move in
/// lockstep (main visually "pushes over" as the rail grows), which only reads
/// as one continuous motion if they're driven by the exact same spring.
export const sidebarSpring: Transition = {
  type: "spring",
  stiffness: 340,
  damping: 32,
  mass: 0.8,
};

/// Shared `layout` transition for toolbar chrome (Toolbar.tsx, ui.tsx's
/// Button, CsvTools' segment group/buttons, and any page-level toolbar
/// controls like ManualCountPage's flagged-count badge) - one spring config
/// so every toolbar item that resizes/reflows in compact mode moves at the
/// same speed instead of drifting out of sync with its neighbors.
export const toolbarLayoutTransition: Transition = {
  layout: { type: "spring", stiffness: 500, damping: 35 },
};
