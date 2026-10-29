import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isConfigured } from './supabase';
import { rpc, type Row } from './db';
import { hasStoredLanguage, useI18n, type Lang } from './i18n';

export interface AuthValue {
  session: Session | null;
  profile: Row | null;
  company: Row | null;
  permissions: Set<string>;
  loading: boolean;
  recovery: boolean;
  isOwner: boolean;
  currency: string;
  can: (perm: string) => boolean;
  canAny: (...perms: string[]) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  setLanguage: (l: Lang) => Promise<void>;
  clearRecovery: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLang } = useI18n();
  const [session, setSession] = useState<Session | null>(null);
  const [ctx, setCtx] = useState<{ profile: Row | null; company: Row | null; permissions: string[] }>({ profile: null, company: null, permissions: [] });
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);

  const loadContext = useCallback(async (s: Session | null) => {
    if (!s) {
      setCtx({ profile: null, company: null, permissions: [] });
      return;
    }
    try {
      const data = await rpc<Row | null>('my_context');
      const profile = data?.profile ?? null;
      const company = data?.company ?? null;
      setCtx({ profile, company, permissions: data?.permissions ?? [] });
      const preferred: Lang | undefined = profile?.language ?? (!hasStoredLanguage() ? company?.default_language : undefined);
      if (preferred === 'en' || preferred === 'dv') setLang(preferred, true);
    } catch {
      setCtx({ profile: null, company: null, permissions: [] });
    }
  }, [setLang]);

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadContext(data.session);
      if (active) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // defer: avoid calling Supabase inside the auth callback
        setTimeout(() => { void loadContext(s); }, 0);
      }
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [loadContext]);

  const value = useMemo<AuthValue>(() => {
    const perms = new Set<string>(ctx.permissions);
    const isOwner = ctx.profile?.role === 'owner';
    const can = (p: string) => isOwner || perms.has(p);
    return {
      session,
      profile: ctx.profile,
      company: ctx.company,
      permissions: perms,
      loading,
      recovery,
      isOwner,
      currency: ctx.company?.currency ?? 'MVR',
      can,
      canAny: (...ps: string[]) => ps.some(can),
      refresh: () => loadContext(session),
      signOut: async () => { await supabase.auth.signOut(); setCtx({ profile: null, company: null, permissions: [] }); },
      setLanguage: async (l: Lang) => {
        setLang(l, true);
        if (ctx.profile?.id) {
          await supabase.from('profiles').update({ language: l }).eq('id', ctx.profile.id);
          setCtx((c) => ({ ...c, profile: c.profile ? { ...c.profile, language: l } : c.profile }));
        }
      },
      clearRecovery: () => setRecovery(false),
    };
  }, [session, ctx, loading, recovery, loadContext, setLang]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
