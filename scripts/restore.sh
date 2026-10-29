#!/usr/bin/env bash
# Restore a Galary backup into an EMPTY Supabase project (or a staging project for the restore drill).
# Usage: TARGET_DB_URL=... bash scripts/restore.sh backups/20261029-020000
set -euo pipefail
DIR="${1:?backup folder}"
: "${TARGET_DB_URL:?Set TARGET_DB_URL of the project to restore into}"
( cd "$DIR" && sha256sum -c SHA256SUMS --quiet ) || { echo "Checksum mismatch — aborting"; exit 1; }
read -r -p "This writes into $TARGET_DB_URL. Type RESTORE to continue: " ok; [ "$ok" = "RESTORE" ] || exit 1
pg_restore --no-owner --no-privileges --dbname="$TARGET_DB_URL" --data-only "$DIR/auth.dump" || true
pg_restore --no-owner --no-privileges --clean --if-exists --dbname="$TARGET_DB_URL" "$DIR/public.dump"
supabase storage cp -r "$DIR/documents" ss:///documents --experimental
echo "✓ Restored. Now run the checks in docs/BACKUP.md → 'Verify the restore'."
