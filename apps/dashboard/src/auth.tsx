import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setUnauthorizedHandler, type Me } from './api';
import { setTimeZone } from './lib/format';

interface AuthValue {
  me: Me | null;
  loading: boolean;
  error: Error | null;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

async function fetchMe(): Promise<Me | null> {
  try {
    return await api.get<Me>('/auth/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const meQuery = useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 5 * 60_000, retry: false });
  const me = meQuery.data ?? null;
  // Zeitzone synchron setzen, bevor Kinder rendern
  setTimeZone(me?.tenant.timezone ?? 'Europe/Berlin');

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(['me'], null);
    });
    return () => setUnauthorizedHandler(null);
  }, [qc]);

  const loginMut = useMutation({
    mutationFn: (v: { email: string; password: string }) => api.post<Me>('/auth/login', v),
    onSuccess: (data) => {
      qc.clear();
      qc.setQueryData(['me'], data);
    },
  });

  const value: AuthValue = {
    me,
    loading: meQuery.isPending,
    error: meQuery.error,
    login: (email, password) => loginMut.mutateAsync({ email, password }),
    logout: async () => {
      try {
        await api.post('/auth/logout');
      } finally {
        qc.clear();
        qc.setQueryData(['me'], null);
      }
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth außerhalb von AuthProvider');
  return ctx;
}

/** Nur innerhalb geschützter Routen verwenden. */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error('Nicht angemeldet');
  return me;
}
