#!/usr/bin/env bash
# End-to-end: scratch Postgres → the real maint-rust → this client's sync
# engine over real HTTP (src-tauri/tests/e2e_sync_live.rs).
#
#   ./scripts/e2e_live.sh
#
# Needs: Postgres on 127.0.0.1:5432 and the maint-rust checkout next to this
# repo (override with MAINT_RUST_DIR). The Postgres role comes from
# E2E_PG_URL (default postgres://maint:secret@127.0.0.1:5432), which must be
# allowed to create databases.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAINT="${MAINT_RUST_DIR:-$ROOT/../maint-rust}"
PG="${E2E_PG_URL:-postgres://maint:secret@127.0.0.1:5432}"
DB=apex_maint_e2e
PORT=8091
SECRET=e2e-secret

echo "── scratch database"
psql "$PG/postgres" -qc "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"

echo "── build + start maint-rust on :$PORT"
(cd "$MAINT" && cargo build --quiet)
BIN="${CARGO_TARGET_DIR:-$MAINT/target}/debug"
DATABASE_URL="$PG/$DB" JWT_SECRET="$SECRET" PORT="$PORT" BIND_ADDR=127.0.0.1 \
FALCON_BASE_URL="http://127.0.0.1:1" "$BIN/maint-rust" &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; psql "$PG/postgres" -qc "DROP DATABASE IF EXISTS $DB" || true' EXIT

for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$PORT/api/maint/health" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:$PORT/api/maint/health" >/dev/null || { echo "server never came up"; exit 1; }

echo "── mint a staff token"
JWT=$(JWT_SECRET="$SECRET" "$BIN/mint_test_token" 77 4)

echo "── run the end-to-end tests"
cd "$ROOT/src-tauri"
# --test-threads=1: the tests set the process-global APEX_BASE_URL (one of
# them to a dead port) and must not race each other.
APEX_E2E_BASE_URL="http://127.0.0.1:$PORT" APEX_E2E_JWT="$JWT" \
  cargo test --test e2e_sync_live -- --test-threads=1

echo "── done"
