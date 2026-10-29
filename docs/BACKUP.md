# Backups and recovery

## Automated (Supabase)
- **Pro plan:** daily backups kept 7 days. Enable **Point-in-Time Recovery** (Database → Backups) to restore to any second.
- Storage objects (uploaded bills and receipts) are **not** covered by database backups. Use the script below.

## Your own off-site copy (weekly, plus before upgrades)
```bash
export SUPABASE_DB_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
bash scripts/backup.sh          # → backups/<timestamp>/{public.dump, auth.dump, documents/, SHA256SUMS}
```
Encrypt the folder (for example `tar czf - backups/<ts> | gpg -c > galary-<ts>.tgz.gpg`) and keep it off-site, such as a cloud drive. Never commit backups to git (`backups/` is ignored).

To automate this, schedule it from a trusted machine (cron) or a private GitHub Action with the URL stored as an encrypted secret.

## Quarterly restore test
1. Create a **new, empty** Supabase project (a staging project).
2. `npx supabase link --project-ref <staging>` and `npx supabase db push` (creates the schema, policies and bucket).
3. `TARGET_DB_URL=<staging db url> bash scripts/restore.sh backups/<timestamp>`
4. **Verify the restore:**
   - Sign in with a real user. The company, boats and crew are visible.
   - *Reports → Financial summary* for last month matches production.
   - Open three random bills. Their documents preview correctly.
   - *Reports → Outstanding crew wage liabilities* and *Supplier balances* match production.
   - `select count(*) from audit_logs;` is close to production.
5. Write the date, backup used, the person who tested and the result in your operations log, then delete the staging project.

## Disaster recovery
1. Prefer **PITR** in the Supabase dashboard to a time just before the incident.
2. If the project is lost: create a new project, then `db push` and `scripts/restore.sh` from the latest off-site backup. Re-deploy the Edge Functions, set the secrets and update the frontend's environment variables.
