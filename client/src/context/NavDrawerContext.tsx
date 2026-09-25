import { createContext, useContext, useState, type ReactNode } from "react";

interface NavAnchor {
  top: number;
  left: number;
}

interface NavDrawerContextValue {
  open: boolean;
  /// Where the floating panel should originate from (Sidebar.tsx) - the
  /// logo button's own on-screen position at the moment it was clicked
  /// (see PageHeader.tsx), so the panel pops out right where the trigger
  /// is instead of a fixed guessed spot.
  anchor: NavAnchor | null;
  toggle: (anchor: NavAnchor) => void;
  close: () => void;
}

const NavDrawerContext = createContext<NavDrawerContextValue | undefined>(undefined);

/// Whether the floating nav panel (Sidebar.tsx) is open, and where it
/// should anchor - lifted up to Layout.tsx (shared ancestor of both
/// Sidebar and every page) since the button that opens it now lives in
/// PageHeader.tsx, rendered deep inside each page rather than next to the
/// panel itself.
export function NavDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<NavAnchor | null>(null);

  return (
    <NavDrawerContext.Provider
      value={{
        open,
        anchor,
        toggle: (nextAnchor) => {
          setAnchor(nextAnchor);
          setOpen((o) => !o);
        },
        close: () => setOpen(false),
      }}
    >
      {children}
    </NavDrawerContext.Provider>
  );
}

export function useNavDrawer() {
  const ctx = useContext(NavDrawerContext);
  if (!ctx) throw new Error("useNavDrawer must be used within a NavDrawerProvider");
  return ctx;
}
