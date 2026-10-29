import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { useI18n } from './lib/i18n';
import { isConfigured, isDemo } from './lib/supabase';
import { Layout } from './components/Layout';
import { Spinner, Alert } from './components/ui';
import { Login, Signup, ForgotPassword, ResetPassword, Onboarding, ConfigMissing } from './pages/Auth';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Boats = lazy(() => import('./pages/Boats'));
const BoatDetail = lazy(() => import('./pages/BoatDetail'));
const Crew = lazy(() => import('./pages/Crew'));
const CrewDetail = lazy(() => import('./pages/CrewDetail'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Trips = lazy(() => import('./pages/Trips'));
const TripDetail = lazy(() => import('./pages/TripDetail'));
const CatchSales = lazy(() => import('./pages/CatchSales'));
const Ledger = lazy(() => import('./pages/Ledger'));
const Bills = lazy(() => import('./pages/Bills'));
const BillDetail = lazy(() => import('./pages/BillDetail'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const WageRules = lazy(() => import('./pages/WageRules'));
const Bonuses = lazy(() => import('./pages/Bonuses'));
const Advances = lazy(() => import('./pages/Advances'));
const FishTaken = lazy(() => import('./pages/FishTaken'));
const Payroll = lazy(() => import('./pages/Payroll'));
const PayrollDetail = lazy(() => import('./pages/PayrollDetail'));
const Adjustments = lazy(() => import('./pages/Adjustments'));
const CrewPayments = lazy(() => import('./pages/CrewPayments'));
const Reports = lazy(() => import('./pages/Reports'));
const Approvals = lazy(() => import('./pages/Approvals'));
const Audit = lazy(() => import('./pages/Audit'));
const Users = lazy(() => import('./pages/Users'));
const Settings = lazy(() => import('./pages/Settings'));

function Loading() {
  return <div className="flex min-h-[50vh] items-center justify-center text-ocean-700"><Spinner size={28} /></div>;
}

function Guard({ perm, children }: { perm?: string; children: ReactNode }) {
  const { can } = useAuth();
  const { t } = useI18n();
  if (perm && !can(perm)) return <Alert tone="warn">{t('common.noAccess')}</Alert>;
  return <>{children}</>;
}

export function App() {
  const { session, profile, loading, recovery } = useAuth();
  const loc = useLocation();

  if (!isConfigured && !isDemo) return <ConfigMissing />;
  if (loading) return <Loading />;
  if (recovery || loc.pathname === '/reset-password') return <ResetPassword />;

  if (!session) {
    return (
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  if (!profile) return <Onboarding />;
  if (!profile.active) return <Onboarding inactive />;

  return (
    <Layout>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Guard perm="dashboard.view"><Dashboard /></Guard>} />
          <Route path="/boats" element={<Boats />} />
          <Route path="/boats/:id" element={<Guard perm="boats.view"><BoatDetail /></Guard>} />
          <Route path="/crew" element={<Crew />} />
          <Route path="/crew/:id" element={<Guard perm="crew.view"><CrewDetail /></Guard>} />
          <Route path="/attendance" element={<Guard perm="attendance.view"><Attendance /></Guard>} />
          <Route path="/trips" element={<Trips />} />
          <Route path="/trips/:id" element={<Guard perm="trips.view"><TripDetail /></Guard>} />
          <Route path="/sales" element={<Guard perm="sales.view"><CatchSales /></Guard>} />
          <Route path="/income" element={<Ledger kind="income" />} />
          <Route path="/expenses" element={<Ledger kind="expense" />} />
          <Route path="/bills" element={<Bills />} />
          <Route path="/bills/new" element={<Guard perm="bills.manage"><BillDetail /></Guard>} />
          <Route path="/bills/:id" element={<Guard perm="bills.view"><BillDetail /></Guard>} />
          <Route path="/suppliers" element={<Guard perm="suppliers.view"><Suppliers /></Guard>} />
          <Route path="/wage-rules" element={<Guard perm="wage_rules.view"><WageRules /></Guard>} />
          <Route path="/bonuses" element={<Guard perm="bonuses.view"><Bonuses /></Guard>} />
          <Route path="/advances" element={<Advances />} />
          <Route path="/fish-taken" element={<FishTaken />} />
          <Route path="/payroll" element={<Guard perm="payroll.view"><Payroll /></Guard>} />
          <Route path="/payroll/:id" element={<Guard perm="payroll.view"><PayrollDetail /></Guard>} />
          <Route path="/adjustments" element={<Adjustments />} />
          <Route path="/crew-payments" element={<Guard perm="crew_payments.view"><CrewPayments /></Guard>} />
          <Route path="/reports" element={<Guard perm="reports.view"><Reports /></Guard>} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/audit" element={<Guard perm="audit.view"><Audit /></Guard>} />
          <Route path="/users" element={<Guard perm="users.manage"><Users /></Guard>} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/signup" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
