import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isPhonePage, phoneHomeFor } from "../config/navigation";
import { useReadOnlyPhone } from "../hooks/useReadOnlyPhone";

/// On a phone only the read-only pages open (config/navigation.ts, PHONE_PAGES);
/// any other address goes to the phone's home page. An allow-list, so a page added
/// later stays off the phone until it is listed. A UI restriction, not a security
/// one: the server still decides what each account may do.
export function PhoneGate() {
  const phone = useReadOnlyPhone();
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (phone && !isPhonePage(pathname)) return <Navigate to={phoneHomeFor(user?.role)} replace />;
  return <Outlet />;
}

/// The "/" address: the entry grid on a computer, the phone's home on a phone.
export function HomeRedirect() {
  const phone = useReadOnlyPhone();
  const { user } = useAuth();
  return <Navigate to={phone ? phoneHomeFor(user?.role) : "/online"} replace />;
}
