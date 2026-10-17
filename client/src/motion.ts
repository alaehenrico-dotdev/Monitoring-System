import type { Transition } from "motion/react";

/// One calm motion for the app: short, ease-out, no spring and no overshoot, so
/// nothing bounces or settles late. Interactions still ease in (they are never
/// instant) but finish before the eye has to wait for them.

/// The account panel's open/close (Sidebar.tsx).
export const sidebarSpring: Transition = {
  duration: 0.16,
  ease: "easeOut",
};
