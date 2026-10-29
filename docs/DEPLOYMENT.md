# Deployment (GitHub + web hosting)

## 1. GitHub
```bash
git init && git add . && git commit -m "Galary"
git branch -M main
git remote add origin git@github.com:<you>/galary.git
git push -u origin main
```
`.github/workflows/ci.yml` runs on every push and pull request. It type-checks, runs the unit tests, builds the app, and runs the **database test-suite** against PostgreSQL 16.

`.env.local` is git-ignored. Never commit keys.

## 2. Host the web app (pick one)

### Vercel
1. *Add New Project* → import the GitHub repo. The framework is detected as **Vite**.
2. Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ALLOW_SIGNUP`.
3. Deploy. `vercel.json` already contains the SPA rewrite and security headers.

### Netlify
1. *Add new site → Import from Git*. `netlify.toml` sets `npm run build` / `dist`.
2. Add the same three environment variables and deploy. `public/_redirects` handles SPA routes.

### Cloudflare Pages
Build command `npm run build`, output `dist`, and the same variables. `_redirects` is supported.

## 3. After the first deploy
1. Supabase → Authentication → URL Configuration: set **Site URL** to the production URL and add `https://<domain>/reset-password` as a redirect URL.
2. `npx supabase secrets set SITE_URL=https://<domain> ALLOWED_ORIGIN=https://<domain>` (restricts CORS on the Edge Functions).
3. Configure custom SMTP for auth emails.
4. Set `VITE_ALLOW_SIGNUP=false` once the company exists, then redeploy.

## 4. Updating
- **Schema changes:** add a new file in `supabase/migrations/` (never edit applied ones), then run `npx supabase db push`.
- **Edge functions:** `npm run functions:deploy`.
- **Frontend:** push to `main`; the host rebuilds automatically.

## 5. Production checklist
- [ ] Supabase **Pro** plan with PITR enabled (see BACKUP.md)
- [ ] Database password stored in a password manager; 2FA on Supabase and GitHub accounts
- [ ] `VITE_ALLOW_SIGNUP=false`
- [ ] Custom SMTP configured, and password reset tested
- [ ] Restore drill done once (BACKUP.md)
- [ ] Dhivehi wording reviewed by a native speaker
- [ ] Test data removed (create production users fresh; do not import test figures)
