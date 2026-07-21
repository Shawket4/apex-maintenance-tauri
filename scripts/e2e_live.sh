#!/usr/bin/env bash
# E2E harness: scratch Postgres → real maint-rust binary → the client engine
# over real HTTP (tests/e2e_sync_live.rs). Run from anywhere:
#
#   ./scripts/e2e_live.sh
#
# Assumes local Postgres on 127.0.0.1:5432 with role `maint` (password
# `secret`, from RUN.md) and the maint-rust checkout next to this repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAINT="$ROOT/../maint-rust"
DB=apex_maint_e2e
PORT=8091
SECRET=e2e-secret
VEHICLE_ID=4242
USER_ID=77

echo "── scratch database"
dropdb -h 127.0.0.1 --if-exists "$DB"
createdb -h 127.0.0.1 "$DB" -O maint

echo "── build + start maint-rust on :$PORT"
(cd "$MAINT" && cargo build --quiet)
DATABASE_URL="postgres://maint:secret@127.0.0.1:5432/$DB" \
JWT_SECRET="$SECRET" \
PORT="$PORT" BIND_ADDR=127.0.0.1 \
FALCON_BASE_URL="http://127.0.0.1:1" \
MAINT_DEV_LOGIN=0 \
"$MAINT/target/debug/maint-rust" &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; dropdb -h 127.0.0.1 --if-exists "$DB"' EXIT

for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/api/maint/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
curl -sf "http://127.0.0.1:$PORT/api/maint/health" >/dev/null || { echo "server never came up"; exit 1; }

echo "── seed vehicle + stock"
psql -h 127.0.0.1 -U maint -d "$DB" -q <<SQL
INSERT INTO vehicles_cache (id, car_no_plate, raw_payload)
VALUES ($VEHICLE_ID, 'E2E 8351', '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO tire_stock_cache (brand, model, size, on_hand_qty)
VALUES ('Pirelli', 'FR01', '315/80R22.5', 5) ON CONFLICT (brand, model, size) DO NOTHING;
INSERT INTO oil_stock_cache (oil_type, liters_on_hand)
VALUES ('15W-40', 200) ON CONFLICT (oil_type) DO NOTHING;
SQL

echo "── mint a JWT"
JWT=$(python3 - "$SECRET" "$USER_ID" <<'PY'
import base64, hashlib, hmac, json, sys, time
secret, uid = sys.argv[1], int(sys.argv[2])
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
claims = b64(json.dumps({
    "user_type": "employee", "user_id": uid, "driver_id": 0,
    "permission": 4, "iss": str(uid), "exp": int(time.time()) + 3600,
}).encode())
sig = b64(hmac.new(secret.encode(), f"{header}.{claims}".encode(), hashlib.sha256).digest())
print(f"{header}.{claims}.{sig}")
PY
)

echo "── run the E2E tests"
cd "$ROOT/src-tauri"
APEX_E2E_BASE_URL="http://127.0.0.1:$PORT" \
APEX_E2E_JWT="$JWT" \
APEX_E2E_VEHICLE_ID="$VEHICLE_ID" \
# --test-threads=1: the two tests configure the process-global APEX_BASE_URL
# (one live, one dead port) and must not race each other.
cargo test --test e2e_sync_live -- --nocapture --test-threads=1

echo "── done"
