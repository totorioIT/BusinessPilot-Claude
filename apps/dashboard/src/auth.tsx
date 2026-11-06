import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, needsSecondFactor, setUnauthorizedHandler, type LoginResult, type Me } from './api';
import { setTimeZone } from './lib/format';

interface AuthValue {
  me: Me | null;
  loading: boolean;
  error: Error | null;
  /** Liefert die Challenge für den zweiten Schritt, wenn die Zwei-Faktor-Anmeldung an ist. */
  login: (email: string, password: string) => Promise<{ challenge: string } | null>;
  verifyMfa: (challenge: string, code: string) => Promise<void>;
  /** Nach Passwortänderung oder Einrichtung der Zwei-Faktor-Anmeldung. */
  setMe: (me: Me) => void;
  logoutEverywhere: () => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Wechselt den Betrieb dieser Sitzung und lädt die Seite neu, damit keine Daten des
   * vorigen Betriebs im Speicher bleiben.
   */
  switchTenant: (tenantId: string, goTo?: string) => Promise<void>;
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

  // Daten eines vorigen Kontos verwerfen, aber die Anmelde-Abfrage selbst behalten, damit die
  // App den Wechsel sofort sieht.
  const dropOtherData = () => qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  const signedIn = (data: Me) => {
    dropOtherData();
    qc.setQueryData(['me'], data);
  };
  const signedOut = () => {
    dropOtherData();
    qc.setQueryData(['me'], null);
  };

  const value: AuthValue = {
    me,
    loading: meQuery.isPending,
    error: meQuery.error,
    login: async (email, password) => {
      const r = await api.post<LoginResult>('/auth/login', { email, password });
      if (needsSecondFactor(r)) return { challenge: r.challenge };
      signedIn(r);
      return null;
    },
    verifyMfa: async (challenge, code) => {
      signedIn(await api.post<Me>('/auth/mfa/verify', { challenge, code }));
    },
    setMe: (data) => qc.setQueryData(['me'], data),
    logoutEverywhere: async () => {
      try {
        await api.post('/auth/logout-all');
      } finally {
        signedOut();
      }
    },
    switchTenant: async (tenantId, goTo = '/') => {
      await api.post<Me>('/auth/tenant', { tenantId });
      window.location.assign(goTo);
    },
    logout: async () => {
      try {
        await api.post('/auth/logout');
      } finally {
        signedOut();
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
