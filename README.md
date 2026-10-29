# Galary · ގަލަރީ

Fishing fleet, crew, bills, payroll and accounting for boat owners in the Maldives, in **English and ދިވެހި** (full RTL).

Galary is a React + TypeScript + Tailwind web app running on **Supabase** (PostgreSQL, Auth, private Storage, Edge Functions). Every figure comes from database records. Financial rules (approvals, payments, payroll finalisation, no double counting) are enforced **inside the database**, not just in the UI.

## What's inside

| Area | Highlights |
|---|---|
| **Dashboard** | KPIs from live data, alerts, monthly/yearly income vs expenses, boat comparison, recent transactions, date and boat filters |
| **Boats / Crew** | Boat registry with photos and documents; crew profiles (English and/or Dhivehi names), boat-assignment history that is never overwritten |
| **Attendance** | Daily or trip register, one record per person per day, logged corrections, locked once payroll is finalised, Excel/PDF register |
| **Trips** | Planned → active → returned → under review → closed, with checks before closing; catch, sales, stock (caught / sold / taken by crew / remaining) |
| **Catch & Sales** | Sales are recognised as income; customer receipts are recorded separately; outstanding balances |
| **Income / Expenses** | Approval workflow, attachments, voids instead of deletes |
| **Bills & Documents** | Phone-camera upload, OCR suggestions that a person must confirm, duplicate detection with a justified override, approve / return / reject / void, installments, overpayment workflow, document versions |
| **Wage engine** | Gross income, net trip profit, fixed pool or agreed amount; equal, percentage, role, fixed, attendance or combined methods; rounding; immutable approved rule versions; per-payroll snapshots |
| **Payroll** | Calculate (on the server) → submit → approve → finalise → wage slips (versioned). Advances, fish taken and adjustments are each deducted exactly once; shortfalls carry forward |
| **Bonuses** | Paid out of the owner's allocation (percentage or fixed), blocked if they exceed it |
| **Crew payments** | Partial or full payments against a slip; the slip itself never changes; duplicate references blocked |
| **Reports** | 27 reports (finance, bills, crew, audit) with Excel (.xlsx) and PDF export in English, Dhivehi or bilingual |
| **Security** | Row-level security per company, role and boat; private bucket with per-file access checks; full audit log |

## Quick start

```bash
npm install
cp .env.example .env.local        # add your Supabase URL + anon key
npx supabase link --project-ref <ref>
npx supabase db push              # creates every table, policy and function
npm run functions:deploy          # payroll + invite-user edge functions
npm run dev                       # http://localhost:5173
```

Full instructions: **[docs/SETUP.md](docs/SETUP.md)** · Deploying: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** · Testing: **[docs/TESTING.md](docs/TESTING.md)** · Accounting basis: **[docs/ACCOUNTING.md](docs/ACCOUNTING.md)** · Backups: **[docs/BACKUP.md](docs/BACKUP.md)** · Security: **[docs/SECURITY.md](docs/SECURITY.md)**

## Project layout

```
src/
  pages/            one file per module (Dashboard, Bills, PayrollDetail, Reports, …)
  components/       UI kit, data table, forms, uploads, charts, layout
  lib/              Supabase client, auth/permissions, i18n, exports (Excel/PDF), storage, OCR
  i18n/en.ts dv.ts  every string in English and Dhivehi (the Dhivehi file must match the English keys)
  print/wageSlip.ts wage slip document (EN / DV / bilingual)
supabase/
  migrations/       schema, workflow functions, views, row-level security, storage
  functions/        Edge Functions: payroll (wage engine) and invite-user
  functions/_shared/wageEngine.ts   the wage engine (shared with the web app for previews)
  tests/            database test-suite (runs on plain PostgreSQL)
tests/              unit tests (wage engine, translations, OCR parsing)
scripts/            test-db.sh, backup.sh, restore.sh
```

## Verification status

- **Database:** 94 assertions pass (`npm run test:db`). They cover tenant isolation, boat permissions, the bill workflow and installments, duplicate and overpayment blocks, payroll calculate → approve → finalise → reverse, single deductions, wage-slip payments and storage access.
- **Wage engine:** 25 unit tests. An end-to-end run (real database inputs → engine → finalise) was also checked.
- **Translations and OCR parsing:** 4 unit tests (all English keys present in Dhivehi, placeholders kept).
- **UI:** every route was rendered in English and Dhivehi in headless Chromium with no runtime errors, and on a 390 px phone screen with no horizontal scroll.
- **Have a native Dhivehi speaker review the wording** in `src/i18n/dv.ts` before go-live.
