# Testing

## Automated

| Command | What it checks |
|---|---|
| `npm test` | Wage engine (all methods, rounding, attendance, bonuses, advances, fish taken, carry-forward, reconciliation, determinism); translation completeness; OCR parsing |
| `npm run test:db` | Applies every migration to a temporary PostgreSQL database and runs `supabase/tests/10_workflow_tests.sql` (94 assertions) |
| `npm run typecheck` | TypeScript strict mode |
| CI | All of the above on every push |

`npm run test:db` needs a local PostgreSQL 15+ (`DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres`). Docker one-liner:
```bash
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
```

The database suite covers: company isolation · manager limited to assigned boats · read-only users see no financial rows · role escalation blocked · crew boat-history kept · duplicate attendance blocked · attendance locked after payroll finalisation · closed trips locked · sale and receipt balances · over-receipt blocked · manual expense needs approval · approved records locked · a bill needs its original document · one expense per approved bill · partial payments and status · duplicate payment reference blocked · retried payment is idempotent · overpayment needs a reason and permission · duplicate invoice detection and justified override · void payment restores balance · payroll inputs (income, expenses, crew, advances, fish) · forged calculation results rejected · tampering with payroll totals blocked · finalisation recovers each advance once and marks fish deductions · slips are immutable · partial crew payment and over-payment block · slip reissue keeps balances · reversal blocked while paid, then releases advances and fish · reports and dashboard totals · audit log · storage file access.

## Manual test script (before go-live)

Use a **separate test Supabase project**, never the production one.

1. **Languages:** switch EN ⇄ ދިވެހި on every menu page. The layout mirrors, names in Thaana show correctly, and amounts stay left-to-right. Refresh: the language is remembered.
2. **Thaana in PDFs:** export a wage slip in Dhivehi and in bilingual mode, and a report in Dhivehi. Check that the vowel marks (fili) sit correctly.
3. **Wage methods:** create one rule per method (equal, percentage, role, fixed, attendance per-day, combined) and use *Preview* in the editor. Compare with a hand calculation.
4. **Bonuses:** a 10% bonus on an owner allocation of 6,550 gives 655. A bonus larger than the allocation is blocked.
5. **Advances:** an advance of 1,000 on a slip whose gross is 500 recovers 500. The next payroll recovers the remaining 500.
6. **Fish taken:** 28 kg × 25 = 700 appears on the slip with type, quantity and price.
7. **Partial bill payment:** a bill of 5,400 paid with 2,000 then 3,400 ends *Paid*. Paying 1 more is blocked.
8. **Partial crew payment:** a net of 8,350 with 5,000 paid shows 3,350 remaining.
9. **Duplicates:** enter the same supplier and invoice number twice. You get a warning, and an override needs a reason.
10. **Permissions:** sign in as a manager restricted to one boat. Other boats, bills and files are invisible, and a direct URL shows "not found".
11. **Documents:** upload a photo from a phone, preview it, download it, and replace it with a reason. The history shows both versions.
12. **Exports:** every report opens in Excel with numbers as numbers, plus a header with period, currency, filters and generation date.
13. **Historical stability:** finalise a payroll, then change the wage rule (as a new version). The old slips and totals don't change.
14. **Reconciliation:** for one month, *Reports → Financial summary*: revenue − expenses − crew wages + fish recovered = net profit. Cross-check with the income, expense and payroll reports.
15. **Mobile:** use the main flows on a phone (bill photo, attendance, payment).
16. **Backup and recovery:** follow docs/BACKUP.md → "Quarterly restore test".

Use realistic test data, but **do not enter test figures into the live production account**.
