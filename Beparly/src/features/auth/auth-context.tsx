import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { Account, api, ApiError, AuthResult, BusinessProfile } from '@/services/api';
import { sessionStorage } from './session-storage';
import { setCurrencySymbolVisible } from '@/features/products/product-rules';

type AuthState = {
  token: string;
  user: Account['user'];
  businesses: BusinessProfile[];
  account: Account | null;
} | null;

type AuthContextValue = {
  session: AuthState;
  restoring: boolean;
  restoreError: string | null;
  retryRestore: () => Promise<void>;
  refreshBusinesses: () => Promise<void>;
  signIn: (phone: string, password: string) => Promise<void>;
  selectBusiness: (businessId: number) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function newSession(result: AuthResult, preferredBusinessId?: number | null): NonNullable<AuthState> {
  const business = result.businesses.find((item) => item.id === preferredBusinessId) ?? result.businesses[0];
  return {
    token: result.token,
    user: result.user,
    businesses: result.businesses,
    account: business ? {
      user: result.user,
      business: { id: business.id, name: business.name, show_currency_symbol: business.show_currency_symbol ?? true, timezone: business.timezone },
      role: business.role,
      can_manage_purchases: business.can_manage_purchases,
    } : null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthState>(null);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  setCurrencySymbolVisible(session?.account?.business.show_currency_symbol ?? true);
  const restoreGeneration = useRef(0);

  const retryRestore = useCallback(async () => {
    const generation = ++restoreGeneration.current;
    setRestoring(true);
    setRestoreError(null);
    try {
      const token = await sessionStorage.token();
      if (!token) return;
      const [result, businessId] = await Promise.all([api.me(token), sessionStorage.businessId()]);
      if (generation !== restoreGeneration.current) return;
      setSession(newSession({ ...result, token }, businessId));
    } catch (error) {
      if (generation !== restoreGeneration.current) return;
      if (error instanceof ApiError && error.status === 401) {
        await sessionStorage.clear();
        setSession(null);
      } else {
        setRestoreError(error instanceof Error ? error.message : 'Could not restore your session.');
      }
    } finally {
      if (generation === restoreGeneration.current) setRestoring(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => { void retryRestore(); }, 0);
    return () => { clearTimeout(timeout); restoreGeneration.current += 1; };
  }, [retryRestore]);

  const acceptAuth = useCallback(async (result: AuthResult) => {
    await sessionStorage.saveToken(result.token);
    if (result.businesses[0]) await sessionStorage.saveBusinessId(result.businesses[0].id);
    restoreGeneration.current += 1;
    setRestoring(false);
    setRestoreError(null);
    setSession(newSession(result));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    restoring,
    restoreError,
    retryRestore,
    async refreshBusinesses() {
      if (!session) return;
      const result = await api.me(session.token);
      setSession((current) => current?.token === session.token
        ? newSession({ ...result, token: current.token }, current.account?.business.id)
        : current);
    },
    async signIn(phone, password) {
      await acceptAuth(await api.login({ phone, password }));
    },
    selectBusiness(businessId) {
      const business = session?.businesses.find((item) => item.id === businessId);
      if (!session || !business) return;
      setSession({ ...session, account: {
        user: session.user,
        business: { id: business.id, name: business.name, show_currency_symbol: business.show_currency_symbol ?? true, timezone: business.timezone },
        role: business.role,
        can_manage_purchases: business.can_manage_purchases,
      } });
      void sessionStorage.saveBusinessId(businessId);
    },
    async signOut() {
      if (!session) return;
      restoreGeneration.current += 1;
      const token = session.token;
      setSession(null);
      await sessionStorage.clear();
      try { await api.logout(token); } catch { /* Local logout must work offline. */ }
    },
  }), [session, restoring, restoreError, retryRestore, acceptAuth]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
