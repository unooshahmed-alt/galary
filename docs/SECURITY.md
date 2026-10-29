# Security model

- **Authentication:** Supabase Auth (email + password, email confirmation, password reset). Staff join by invitation from an owner.
- **Tenant isolation:** every row has a `company_id`. Row-level security limits every table to the signed-in user's company, and `company_id` cannot be changed after insert.
- **Roles and permissions:** Owner, Manager, Payroll Officer, Accountant and Read-only, with a per-company permission matrix (`role_permissions`). Owners always have every permission. Checks happen in the database (`has_perm`) in both policies and functions, so hiding a button is never the only protection.
- **Boat access:** non-owners see only the boats assigned to them (or *all boats* if granted). This applies to boats, trips, attendance, sales, bills, payroll, slips, payments and documents.
- **Workflow functions:** status changes (approve, pay, finalise, void, reverse) run only through `SECURITY DEFINER` functions. Each checks permission, company and boat, validates amounts, and logs the action. Direct table updates that would bypass them are rejected by triggers.
- **Trusted calculation:** payroll results are written only by `apply_payroll_calculation`, which only the service role (the Edge Function) can call. The inputs hash prevents stale or forged results.
- **Idempotency and duplicates:** payments carry a client request id (a retry is not a second payment), payment references are unique among valid payments, and bill duplicates need a justified override.
- **Documents:** private bucket only. Paths start with the company id. A file can be read only if its `documents` row is visible to the user under row-level security, and access uses signed URLs valid for 5 minutes. Type is checked by extension, browser MIME and magic bytes; size by the bucket and table limits. Files are never overwritten: a replacement is a new version with a required reason.
- **Audit:** every insert, update and delete on business tables is written to `audit_logs` (old and new values, changed fields, user and time), plus a readable approval history.
- **Secrets:** only the public anon key is in the frontend. The service role key exists only inside Edge Functions.
- **Headers:** `vercel.json` / `netlify.toml` set `nosniff`, `DENY` framing, a referrer policy, and a permissions policy allowing the camera for bill photos.
