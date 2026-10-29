import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, allowSignup } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { rpc, errorText } from '@/lib/db';
import { Alert, Button, Field, Input, Select } from '@/components/ui';

function Shell({ title, children }: { title: string; children: ReactNode }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-ocean-900 via-ocean-800 to-ocean-700 px-4 py-10">
      <div className="mb-6 flex items-center gap-3 text-white">
        <img src="/favicon.svg" alt="" className="h-11 w-11" />
        <div>
          <div className="text-2xl font-semibold">{t('app.name')}</div>
          <div className="text-sm text-ocean-200">{t('app.tagline')}</div>
        </div>
      </div>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          <button className="rounded-md border border-slate-300 px-2 py-1 text-xs" onClick={() => setLang(lang === 'en' ? 'dv' : 'en')}>
            {lang === 'en' ? 'ދިވެހި' : 'English'}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfigMissing() {
  const { t } = useI18n();
  return (
    <Shell title={t('errors.configMissing')}>
      <Alert tone="warn">{t('errors.configHelp')}</Alert>
      <p className="mt-3 text-sm text-slate-600">See <code>docs/SETUP.md</code>.</p>
    </Shell>
  );
}

export function Login() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setErr(error.message);
    setBusy(false);
  };
  return (
    <Shell title={t('auth.signIn')}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        <Field label={t('auth.email')}><Input type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={t('auth.password')}><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>{t('auth.signIn')}</Button>
        <div className="flex justify-between text-sm">
          <Link to="/forgot-password" className="text-ocean-700 hover:underline">{t('auth.forgot')}</Link>
          {allowSignup && <Link to="/signup" className="text-ocean-700 hover:underline">{t('auth.signUp')}</Link>}
        </div>
      </form>
    </Shell>
  );
}

export function Signup() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!allowSignup) return <Shell title={t('auth.signUp')}><Alert tone="info">{t('auth.signupDisabled')}</Alert><Link to="/" className="mt-3 block text-sm text-ocean-700">{t('auth.signIn')}</Link></Shell>;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setErr(t('auth.passwordTooShort')); return; }
    setBusy(true); setErr(null);
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
    if (error) setErr(error.message);
    else if (!data.session) setDone(true);
    setBusy(false);
  };
  return (
    <Shell title={t('auth.signUp')}>
      {done ? <Alert tone="success">{t('auth.checkEmail')}</Alert> : (
        <form onSubmit={submit} className="space-y-3">
          {err && <Alert tone="error">{err}</Alert>}
          <Field label={t('auth.email')}><Input type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label={t('auth.password')} hint={t('auth.passwordTooShort')}><Input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>{t('auth.signUp')}</Button>
        </form>
      )}
      <div className="mt-3 text-sm">{t('auth.haveAccount')} <Link to="/" className="text-ocean-700 hover:underline">{t('auth.signIn')}</Link></div>
    </Shell>
  );
}

export function ForgotPassword() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    setSent(true); setBusy(false);   // same message whether or not the account exists
  };
  return (
    <Shell title={t('auth.resetTitle')}>
      {sent ? <Alert tone="success">{t('auth.resetSent')}</Alert> : (
        <form onSubmit={submit} className="space-y-3">
          <Field label={t('auth.email')}><Input type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>{t('auth.sendReset')}</Button>
        </form>
      )}
      <Link to="/" className="mt-3 block text-sm text-ocean-700 hover:underline">{t('auth.signIn')}</Link>
    </Shell>
  );
}

export function ResetPassword() {
  const { t } = useI18n();
  const { clearRecovery, session } = useAuth();
  const nav = useNavigate();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (p1.length < 8) return setErr(t('auth.passwordTooShort'));
    if (p1 !== p2) return setErr(t('auth.passwordsDontMatch'));
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.updateUser({ password: p1 });
    setBusy(false);
    if (error) setErr(error.message);
    else { setOk(true); clearRecovery(); setTimeout(() => nav('/', { replace: true }), 1200); }
  };
  return (
    <Shell title={t('auth.updatePassword')}>
      {!session && !ok && <Alert tone="info">{t('auth.resetSent')}</Alert>}
      {ok ? <Alert tone="success">{t('auth.passwordUpdated')}</Alert> : (
        <form onSubmit={submit} className="mt-2 space-y-3">
          {err && <Alert tone="error">{err}</Alert>}
          <Field label={t('auth.newPassword')}><Input type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} /></Field>
          <Field label={t('auth.confirmPassword')}><Input type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} /></Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!session}>{t('auth.updatePassword')}</Button>
        </form>
      )}
    </Shell>
  );
}

export function Onboarding({ inactive }: { inactive?: boolean }) {
  const { t, lang } = useI18n();
  const { refresh, signOut } = useAuth();
  const [company, setCompany] = useState('');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState(lang);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (inactive) {
    return <Shell title={t('app.name')}><Alert tone="warn">{t('auth.inactive')}</Alert>
      <Button className="mt-4 w-full" onClick={() => void signOut()}>{t('common.signOut')}</Button></Shell>;
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await rpc('bootstrap_company', { p_company_name: company.trim(), p_full_name: name.trim(), p_language: language });
      await refresh();
    } catch (ex) { setErr(errorText(ex, t)); } finally { setBusy(false); }
  };
  return (
    <Shell title={t('auth.onboardingTitle')}>
      <p className="mb-3 text-sm text-slate-600">{allowSignup ? t('auth.onboardingText') : t('auth.notInvited')}</p>
      {allowSignup && (
        <form onSubmit={submit} className="space-y-3">
          {err && <Alert tone="error">{err}</Alert>}
          <Field label={t('auth.companyName')} required><Input required value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
          <Field label={t('auth.fullName')} required><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t('settings.defaultLanguage')}>
            <Select value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'dv')}>
              <option value="en">English</option><option value="dv">ދިވެހި</option>
            </Select>
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>{t('auth.createCompany')}</Button>
        </form>
      )}
      <Button variant="ghost" className="mt-3 w-full" onClick={() => void signOut()}>{t('common.signOut')}</Button>
    </Shell>
  );
}
