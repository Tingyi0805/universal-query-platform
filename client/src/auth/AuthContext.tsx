import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { apiRequest } from "../api/client";

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  permissions: string[];
};

type AuthState = {
  user: AuthUser | null;
  accessToken: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
};

const STORAGE_KEY = "uqp.auth";

const AuthContext = createContext<AuthState | null>(null);

function readStoredAuth(): { user: AuthUser; accessToken: string } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user || !parsed?.accessToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const initial = readStoredAuth();
  const [user, setUser] = useState<AuthUser | null>(initial?.user ?? null);
  const [accessToken, setAccessToken] = useState<string | null>(initial?.accessToken ?? null);

  const value = useMemo<AuthState>(() => ({
    user,
    accessToken,
    async login(username, password) {
      const result = await apiRequest<{
        user: AuthUser;
        accessToken: string;
      }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });

      setUser(result.user);
      setAccessToken(result.accessToken);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
    },
    logout() {
      setUser(null);
      setAccessToken(null);
      sessionStorage.removeItem(STORAGE_KEY);
    },
    hasPermission(permission) {
      return Boolean(user?.permissions.includes(permission));
    },
  }), [user, accessToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
