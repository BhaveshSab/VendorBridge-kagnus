import { motion } from "framer-motion";
import { ShieldAlert } from "lucide-react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../lib/types";
import { Spinner } from "./ui";

export function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-card bg-brand-700 text-[13px] font-bold text-white">
          VB
        </span>
        <Spinner label="Loading workspace" />
      </div>
    </div>
  );
}

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/**
 * Role-gated route wrapper. This is a usability guard only — every API route
 * enforces the same restriction server-side.
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) {
    return (
      <div className="page-shell">
        <div className="card mx-auto max-w-lg px-6 py-12 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-danger-soft text-danger border border-danger/20">
            <ShieldAlert size={22} aria-hidden />
          </span>
          <h1 className="text-[18px] font-bold text-ink">You do not have access to this area</h1>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-muted">
            This section is limited to authorised procurement staff. Your role cannot view or change these records.
          </p>
          <Link to="/dashboard" className="btn btn-ghost btn-sm mt-5 inline-flex">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function Page({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
