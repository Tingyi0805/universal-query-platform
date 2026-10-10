import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function ProtectedRoute() {
  const { user } = useAuth();
  const location = useLocation();

  if (user) return <Outlet />;

  const from = `${location.pathname}${location.search}${location.hash}`;
  return <Navigate to="/login" replace state={{ from }} />;
}
