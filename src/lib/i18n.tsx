import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from '@/i18n/en';
import dv from '@/i18n/dv';

export type Lang = 'en' | 'dv';
/** Export / print language: English, Dhivehi or both side by side. */
export type ExportLang = Lang | 'bi';
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

const dicts: Record<Lang, unknown> = { en, dv };
const STORAGE_KEY = 'galary.lang';

function lookup(dict: unknown, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = lookup(dicts[lang], key) ?? lookup(en, key) ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Translator for exports: 'bi' produces "English / ދިވެހި". */
export function exportT(mode: ExportLang): TFn {
  if (mode === 'bi') {
    return (key, vars) => {
      const a = translate('en', key, vars);
      const b = translate('dv', key, vars);
      return a === b ? a : `${a} / ${b}`;
    };
  }
  return (key, vars) => translate(mode, key, vars);
}

interface I18nValue {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  t: TFn;
  setLang: (l: Lang, persist?: boolean) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

function readStored(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dv' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readStored() ?? 'en');

  const setLang = useCallback((l: Lang, persist = true) => {
    setLangState(l);
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, l); } catch { /* storage unavailable */ }
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang === 'dv' ? 'dv' : 'en';
    root.dir = lang === 'dv' ? 'rtl' : 'ltr';
    document.body.classList.toggle('lang-dv', lang === 'dv');
  }, [lang]);

  const value = useMemo<I18nValue>(() => ({
    lang,
    dir: lang === 'dv' ? 'rtl' : 'ltr',
    t: (key, vars) => translate(lang, key, vars),
    setLang,
  }), [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error('useI18n must be used inside I18nProvider');
  return v;
}

export const hasStoredLanguage = () => readStored() !== null;
