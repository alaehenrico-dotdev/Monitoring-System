import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { LoadingBlock } from "../components/Spinner";
import { ForcedPasswordChange } from "../pages/ForcedPasswordChange";
import type { Role } from "../types";

export function ProtectedRoute({ allow }: { allow?: Role[] }) {
  const { user, loading } = useAuth();

  if (loading) return <LoadingBlock label="" minHeight="var(--ae-vh)" size="xxl" />;
  if (!user) return <Navigate to="/login" replace />;
  // A password someone else knows must be replaced before anything else is reachable
  // (the server refuses every other request until then).
  if (user.mustChangePassword) return <ForcedPasswordChange />;
  if (allow && !allow.includes(user.role)) return <Navigate to="/" replace />;

  return <Outlet />;
}
