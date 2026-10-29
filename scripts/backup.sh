#!/usr/bin/env bash
# Galary backup: database dump + copy of every uploaded document.
# Requires: pg_dump (v15+), Supabase CLI logged in and linked (`supabase link`).
# Usage: SUPABASE_DB_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres" bash scripts/backup.sh
set -euo pipefail
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL (Project Settings → Database → Connection string, session mode)}"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="backups/$STAMP"
mkdir -p "$OUT"
echo "→ Dumping schema + data (public, auth, storage metadata)…"
pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges --schema=public --format=custom --file="$OUT/public.dump"
pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges --schema=auth --data-only --format=custom --file="$OUT/auth.dump"
echo "→ Copying private documents bucket…"
supabase storage cp -r ss:///documents "$OUT/documents" --experimental
( cd "$OUT" && find . -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS )
echo "✓ Backup written to $OUT  (keep an encrypted off-site copy; see docs/BACKUP.md)"
