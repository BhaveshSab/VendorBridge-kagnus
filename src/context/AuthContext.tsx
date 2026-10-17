import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { Permissions, Session, User, Vendor } from "../lib/types";

export interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: "procurement" | "manager" | "vendor";
  country: string;
  additionalInfo: string;
  password: string;
  companyName: string;
  category: string;
}

interface AuthValue {
  user: User | null;
  vendor: Vendor | null;
  permissions: Permissions | null;
  roleLabel: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await api.get<Session>("/auth/me");
      setSession(next);
    } catch {
      setSession(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    api
      .get<Session>("/auth/me")
      .then((next) => {
        if (active) setSession(next);
      })
      .catch(() => {
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const next = await api.post<Session>("/auth/login", { email, password });
    setSession(next);
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    const next = await api.post<Session>("/auth/register", payload);
    setSession(next);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      setSession(null);
    }
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user: session?.user ?? null,
      vendor: session?.vendor ?? null,
      permissions: session?.permissions ?? null,
      roleLabel: session?.roleLabel ?? null,
      loading,
      login,
      register,
      logout,
      refresh,
    }),
    [session, loading, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
