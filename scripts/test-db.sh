#!/usr/bin/env bash
# Runs all migrations + the database test-suite against a throw-away local PostgreSQL 15+.
# Usage: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres bash scripts/test-db.sh
set -euo pipefail
DB_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
DB_NAME="galary_test_$$"
ADMIN_URL="${DB_URL%/*}/postgres"
psql "$ADMIN_URL" -qc "create database $DB_NAME"
trap 'psql "$ADMIN_URL" -qc "drop database if exists $DB_NAME" >/dev/null' EXIT
TEST_URL="${DB_URL%/*}/$DB_NAME"
cd "$(dirname "$0")/.."
cat supabase/tests/00_supabase_stubs.sql supabase/migrations/*.sql | psql "$TEST_URL" -v ON_ERROR_STOP=1 -q >/dev/null
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -t -o /dev/null -f supabase/tests/10_workflow_tests.sql 2>&1 | grep -E "ok|PASSED|ERROR|FAIL" | sed 's/^.*NOTICE:  //'
