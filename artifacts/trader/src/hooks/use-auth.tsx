import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type AuthState = {
  loading: boolean;
  authRequired: boolean;
  authenticated: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  const refresh = async () => {
    try {
      const r = await api("/auth/me");
      const data = await r.json();
      setAuthRequired(!!data.authRequired);
      setAuthenticated(!!data.authenticated);
    } catch {
      setAuthRequired(false);
      setAuthenticated(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const login = async (password: string) => {
    const r = await api("/auth/login", { method: "POST", body: JSON.stringify({ password }) });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || "Ошибка входа");
    }
    await refresh();
  };

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    await refresh();
  };

  return (
    <AuthContext.Provider value={{ loading, authRequired, authenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
