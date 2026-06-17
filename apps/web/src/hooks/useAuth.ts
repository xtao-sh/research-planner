import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AuthUser,
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
} from '../api/auth';

export interface UseAuth {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

export function useAuth(): UseAuth {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchMe();
        if (!cancelled) setUser(me);
      } catch (_err) {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const u = await apiLogin(email, password);
    setUser(u);
  }, []);

  const register = useCallback(
    async (email: string, password: string, name?: string) => {
      const u = await apiRegister(email, password, name);
      setUser(u);
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch (_err) {
      // Even if logout API fails, clear the client-side user state.
    }
    setUser(null);
  }, []);

  return useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout]
  );
}
