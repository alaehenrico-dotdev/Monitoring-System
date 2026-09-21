import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { LoadingBlock } from "../components/Spinner";
import type { Role } from "../types";

export function ProtectedRoute({ allow }: { allow?: Role[] }) {
  const { user, loading } = useAuth();

  if (loading) return <LoadingBlock label="Loading…" minHeight="100vh" size="lg" />;
  if (!user) return <Navigate to="/login" replace />;
  if (allow && !allow.includes(user.role)) return <Navigate to="/" replace />;

  return <Outlet />;
}
