import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { isPhonePage } from "../config/navigation";
import { useReadOnlyPhone } from "../hooks/useReadOnlyPhone";

/// A link that, on a phone, is left out (or shown as plain text with `plain`) when its page is not one a
/// phone can open (config/navigation.ts, PHONE_PAGES) - a tap would only bounce back.
export function PhoneSafeLink({ to, className, children, plain = false }: { to: string; className?: string; children: ReactNode; plain?: boolean }) {
  const phone = useReadOnlyPhone();
  if (phone && !isPhonePage(to.split("?")[0])) return plain ? <div className={className}>{children}</div> : null;
  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}
