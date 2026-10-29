import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { cx } from './ui';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { rpc, type Row } from '@/lib/db';

export interface NavItem { to: string; icon: string; label: string; perm?: string; anyPerm?: string[]; group: 'ops' | 'money' | 'payroll' | 'admin' }

export const NAV: NavItem[] = [
  { to: '/', icon: 'dashboard', label: 'nav.dashboard', perm: 'dashboard.view', group: 'ops' },
  { to: '/boats', icon: 'boat', label: 'nav.boats', perm: 'boats.view', group: 'ops' },
  { to: '/crew', icon: 'users', label: 'nav.crew', perm: 'crew.view', group: 'ops' },
  { to: '/attendance', icon: 'calendar', label: 'nav.attendance', perm: 'attendance.view', group: 'ops' },
  { to: '/trips', icon: 'anchor', label: 'nav.trips', perm: 'trips.view', group: 'ops' },
  { to: '/sales', icon: 'fish', label: 'nav.sales', perm: 'sales.view', group: 'ops' },
  { to: '/income', icon: 'up', label: 'nav.income', perm: 'income.view', group: 'money' },
  { to: '/expenses', icon: 'down', label: 'nav.expenses', perm: 'expenses.view', group: 'money' },
  { to: '/bills', icon: 'receipt', label: 'nav.bills', perm: 'bills.view', group: 'money' },
  { to: '/suppliers', icon: 'truck', label: 'nav.suppliers', perm: 'suppliers.view', group: 'money' },
  { to: '/wage-rules', icon: 'scale', label: 'nav.wageRules', perm: 'wage_rules.view', group: 'payroll' },
  { to: '/bonuses', icon: 'gift', label: 'nav.bonuses', perm: 'bonuses.view', group: 'payroll' },
  { to: '/advances', icon: 'wallet', label: 'nav.advances', perm: 'advances.view', group: 'payroll' },
  { to: '/fish-taken', icon: 'hand', label: 'nav.fishTaken', perm: 'fish_taken.view', group: 'payroll' },
  { to: '/payroll', icon: 'calculator', label: 'nav.payroll', perm: 'payroll.view', group: 'payroll' },
  { to: '/adjustments', icon: 'sliders', label: 'nav.adjustments', perm: 'adjustments.view', group: 'payroll' },
  { to: '/crew-payments', icon: 'banknote', label: 'nav.crewPayments', perm: 'crew_payments.view', group: 'payroll' },
  { to: '/reports', icon: 'chart', label: 'nav.reports', perm: 'reports.view', group: 'admin' },
  { to: '/approvals', icon: 'check', label: 'nav.approvals', anyPerm: ['bills.approve', 'transactions.approve', 'advances.approve', 'fish_taken.approve', 'bonuses.approve', 'adjustments.approve', 'payroll.approve'], group: 'admin' },
  { to: '/audit', icon: 'history', label: 'nav.audit', perm: 'audit.view', group: 'admin' },
  { to: '/users', icon: 'shield', label: 'nav.users', perm: 'users.manage', group: 'admin' },
  { to: '/settings', icon: 'settings', label: 'nav.settings', group: 'admin' },
];

const GROUPS: { id: NavItem['group']; label: string }[] = [
  { id: 'ops', label: 'nav.groupOperations' }, { id: 'money', label: 'nav.groupMoney' },
  { id: 'payroll', label: 'nav.groupPayroll' }, { id: 'admin', label: 'nav.groupAdmin' },
];

function LanguageSwitch() {
  const { lang } = useI18n();
  const { setLanguage } = useAuth();
  return (
    <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs font-medium" role="group" aria-label="Language">
      <button onClick={() => void setLanguage('en')} className={cx('rounded-md px-2 py-1', lang === 'en' ? 'bg-ocean-700 text-white' : 'text-slate-600')}>EN</button>
      <button onClick={() => void setLanguage('dv')} className={cx('rounded-md px-2 py-1 font-thaana', lang === 'dv' ? 'bg-ocean-700 text-white' : 'text-slate-600')}>ދިވެހި</button>
    </div>
  );
}

function AlertsBell() {
  const { t } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();
  const [alerts, setAlerts] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    rpc<Row[]>('get_alerts').then((a) => { if (alive) setAlerts(a ?? []); }).catch(() => undefined);
    return () => { alive = false; };
  }, [loc.pathname]);
  const total = alerts.reduce((s, a) => s + Number(a.count ?? 0), 0);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label={t('dashboard.alerts')}>
        <Icon name="bell" />
        {total > 0 && <span className="absolute -top-0.5 end-0 min-w-[18px] rounded-full bg-coral-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white">{total > 99 ? '99+' : total}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute end-0 z-40 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
            <div className="px-2 py-1 text-xs font-semibold uppercase text-slate-500">{t('dashboard.alerts')}</div>
            {alerts.length === 0 ? <div className="px-2 py-4 text-sm text-slate-500">{t('dashboard.noAlerts')}</div> : alerts.map((a) => (
              <button key={a.key} onClick={() => { setOpen(false); nav(a.link); }}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-start text-sm hover:bg-slate-50">
                <Icon name="alert" size={16} className={a.severity === 'danger' ? 'text-coral-600' : a.severity === 'warning' ? 'text-amber-600' : 'text-ocean-600'} />
                <span>{t(`alerts.${a.key}`, { count: a.count })}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { profile, company, can, canAny, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobileOpen(false), [loc.pathname]);

  const visible = NAV.filter((n) => (!n.perm || can(n.perm)) && (!n.anyPerm || canAny(...n.anyPerm)));

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <img src="/favicon.svg" alt="" className="h-8 w-8" />
        <div className="min-w-0">
          <div className="font-semibold text-white">{t('app.name')}</div>
          <div className="truncate text-xs text-ocean-200">{company?.name}</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {GROUPS.map((g) => {
          const items = visible.filter((n) => n.group === g.id);
          if (!items.length) return null;
          return (
            <div key={g.id} className="mb-3">
              <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ocean-300">{t(g.label)}</div>
              {items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.to === '/'}
                  className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition',
                    isActive ? 'bg-white/15 font-medium text-white' : 'text-ocean-100 hover:bg-white/10 hover:text-white')}>
                  <Icon name={n.icon} size={17} />{t(n.label)}
                </NavLink>
              ))}
            </div>
          );
        })}
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-sand-50">
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 bg-ocean-900 lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-72 bg-ocean-900 shadow-xl">{sidebar}</aside>
        </div>
      )}
      <div className="lg:ps-64">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-slate-200 bg-white/90 px-3 py-2 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Menu"><Icon name="menu" /></button>
          <div className="flex-1" />
          <LanguageSwitch />
          <AlertsBell />
          <div className="hidden text-end sm:block">
            <div className="text-sm font-medium text-slate-800">{profile?.full_name || profile?.email}</div>
            <div className="text-xs text-slate-500">{t(`roles.${profile?.role}`)}</div>
          </div>
          <button onClick={() => void signOut()} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" title={t('common.signOut')} aria-label={t('common.signOut')}>
            <Icon name="logout" className="rtl:rotate-180" />
          </button>
        </header>
        <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
