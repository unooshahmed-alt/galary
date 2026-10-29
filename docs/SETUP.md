# Setup

## 1. Requirements
- Node.js 18.18+ (20 LTS recommended) and npm
- A Supabase project (free tier is fine for testing; **Pro** is recommended for production because of daily backups and Point-in-Time Recovery)
- Supabase CLI: `npm i -g supabase` or use `npx supabase`

## 2. Install
```bash
git clone <your repo> galary && cd galary
npm install
```

## 3. Connect to Supabase
1. Supabase dashboard → **Project Settings → API**: copy the *Project URL* and the **anon public** key.
2. `cp .env.example .env.local` and fill in:
   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   VITE_ALLOW_SIGNUP=true
   ```
   **Never** put the `service_role` key in any `VITE_` variable. It is only used inside Edge Functions, which Supabase provides automatically.

## 4. Create the database
```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push
```
This applies `supabase/migrations/*` in order: tables, constraints, triggers, workflow functions, views, row-level security and the **private** `documents` storage bucket (20 MB limit, PDF/JPG/PNG/WEBP/HEIC/XLSX/CSV only).

## 5. Deploy the Edge Functions
```bash
npx supabase functions deploy payroll
npx supabase functions deploy invite-user
npx supabase secrets set SITE_URL=https://your-domain.example ALLOWED_ORIGIN=https://your-domain.example
```
- `payroll` runs the wage engine on the server and saves results through a database function that only the service role can call.
- `invite-user` lets an owner invite staff by email.

## 6. Auth settings (Supabase → Authentication)
- **URL Configuration:** Site URL = your app URL; add `https://your-domain/reset-password` to *Redirect URLs* (and `http://localhost:5173/reset-password` for development).
- **Email:** keep *Confirm email* on. For production, configure your own SMTP sender (Authentication → SMTP).
- Optional: set the minimum password length to 8 or more.

## 7. First run
```bash
npm run dev
```
1. Open http://localhost:5173 → **Create account** → confirm by email → sign in.
2. Create your company. You become the **Owner**, and the default categories and fish types are created.
3. **Settings:** company name (English and Dhivehi), default language, currency (MVR), workflow rules.
4. **Boats → Register boat**, **Crew → Add crew member** (assign to a boat).
5. **Wage Rules:** create a rule for each boat, then *Approve* it. Payroll needs an approved version.
6. **Users and Permissions → Invite user**: managers, payroll officers, accountants, read-only users. Pick their boats.
7. Once your team is set up, set `VITE_ALLOW_SIGNUP=false` and redeploy, so strangers cannot create companies.

## Optional: run Supabase locally
```bash
npx supabase start          # needs Docker
npx supabase db reset       # applies all migrations to the local DB
npx supabase functions serve
```
Use the local URL and anon key printed by `supabase start` in `.env.local`.

## Configuration screen
Everything a company configures lives in **Settings**: company details, currency, default language, approval requirements, upload size, OCR on/off, categories, fish types and which roles receive each alert. Permissions per role are under **Users and Permissions → Permission matrix**.
