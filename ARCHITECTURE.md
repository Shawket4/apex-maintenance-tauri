# Apex Maintenance — System Architecture

**Audience:** the Claude agent (or human) implementing this system from scratch.
**Status:** design-final, ready to build.
**Owner:** Shawket (Apex Transport).
**Last updated:** 2026-05-04.

---

## 0. Read this first

This document is the single source of truth for the build. Every schema, every API contract, every architectural decision recorded below was negotiated and locked in over a multi-turn design conversation. Do not improvise around them — if a constraint here looks wrong, surface the question to the owner before deviating.

The system has three hard requirements that drive most decisions:

1. **Offline-first.** The desktop app must work without internet. Every read is served from a local cache; every write goes to a local outbox and syncs later. Online is the happy path, not a precondition.
2. **Arabic-default, Egyptian-dialect-first.** UI labels, validation messages, dates, numbers, and document content default to Arabic with Egyptian-dialect phrasing. English is the secondary language, available via a toggle. RTL layout is the default.
3. **Built for non-technical users.** Mechanics and shop supervisors will use this. Big targets, plain language, no jargon, opinionated single-path workflows. When in doubt, choose fewer options over more.

If a feature you implement violates any of these three, stop and reconsider.

---

## 1. System overview

Three deployables:

```
┌─────────────────────────────────────────────────────────────┐
│  apex-maintenance  (Tauri 2 + React 19 + TS)                │
│  Desktop app, ~25 MB binary, Windows/macOS/Linux            │
│  ─ Local SQLite for cache + outbox                          │
│  ─ JWT in OS keyring                                        │
│  ─ All UI logic, all rendering, all offline behavior        │
└─────────────────────────────────────────────────────────────┘
                  │ HTTPS, Bearer JWT
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  maint-rust  (Actix-web 4 + SQLx + Tokio)                   │
│  Owned-data API for templates, records, tires, chassis      │
│  ─ Postgres for canonical owned data                        │
│  ─ Redis for response caching of Falcon proxies             │
│  ─ Verifies JWTs against shared HS256 secret                │
└─────────────────────────────────────────────────────────────┘
                  │ HTTPS, Bearer JWT (relayed)
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  Falcon Go  (existing, do not modify beyond auth tweak)     │
│  ─ POST /api/login, /api/logout                             │
│  ─ GET  /api/cars        (vehicles + nested drivers)        │
│  ─ GET  /api/service-invoices                               │
│  ─ GET  /api/service-invoices/search?query=                 │
│  Required change: include `jwt` in /api/login JSON response │
│  (already implemented; confirmed by curl evidence).         │
└─────────────────────────────────────────────────────────────┘
```

**Data flow rules:**

- The Tauri client never talks to Falcon directly — every external call is proxied through `maint-rust`. This centralizes auth, caching, retry, and rate-limiting in one place.
- `maint-rust` does not own a `users` table. Identity comes from the JWT, verified using the same HS256 secret as Falcon.
- All "owned data" (maintenance templates, records, chassis layouts, tires, assignments, odometer overrides) lives in `maint-rust`'s Postgres and is mirrored to the client's SQLite for offline reads.
- All "cached data" (vehicles, drivers, service invoices) is upstream-owned by Falcon; we mirror it locally with TTL-based freshness and serve stale-while-offline.

---

## 2. Tech stack — exact versions

### `apex-maintenance` (desktop client)

| Layer | Choice | Version | Notes |
|---|---|---|---|
| Shell | Tauri | 2.x | Use Tauri 2's plugin system, not Tauri 1 |
| Runtime | Node.js | ≥ 20 LTS | For Vite dev/build |
| Bundler | Vite | 5.x | |
| UI framework | React | 19 | Match apex-react |
| Language | TypeScript | 5.x | strict: true |
| Routing | TanStack Router | 1.x | Type-safe, file-based |
| Server state | TanStack Query | 5.x | Match apex-react |
| Client state | Zustand | 4.x | For local UI state only |
| Forms | TanStack Form | 1.x | Or react-hook-form + zod |
| Validation | zod | 3.x | Schema-first, share with backend types |
| UI library | shadcn/ui | latest | Match apex-react |
| Styling | Tailwind CSS | 3.x | RTL via `dir="rtl"` on `<html>` |
| Tables | TanStack Table | 8.x | |
| Icons | lucide-react | latest | |
| i18n | react-i18next + i18next | latest | AR default, EN fallback |
| Date | dayjs + dayjs-arabic-locale | latest | Africa/Cairo timezone everywhere |
| HTTP | ky | latest | Thin wrapper, retry, Bearer auth |
| Local DB | better-sqlite3 (via Tauri Rust side) | latest | Sync access from Rust core |
| Keyring | tauri-plugin-stronghold | 2.x | OR tauri-plugin-keyring |
| Charts | Recharts | 2.x | Match apex-react |

### `maint-rust` (backend)

| Layer | Choice | Version | Notes |
|---|---|---|---|
| Language | Rust | ≥ 1.75 stable | Match apex-rust |
| Framework | Actix-web | 4.x | Match apex-rust pattern |
| Async | tokio | 1.x | |
| DB driver | sqlx | 0.7.x | compile-time-checked queries |
| DB | PostgreSQL | ≥ 16 | |
| Cache | Redis | ≥ 7 | Optional but recommended |
| JWT | jsonwebtoken | 9.x | HS256 |
| Serde | serde, serde_json | 1.x | |
| Logging | tracing, tracing-subscriber | latest | |
| Error | thiserror, anyhow | latest | |
| HTTP client | reqwest | 0.12.x | For calling Falcon |
| Migrations | sqlx-cli | 0.7.x | Versioned migrations in `/migrations` |
| UUID | uuid v4 | 1.x | gen_random_uuid() server-side |
| Time | chrono | 0.4.x | All timestamps UTC, format on read |

### Infrastructure

- Falcon Go and `maint-rust` deployed on the same Hostinger Debian VPS Shawket already operates. No new infrastructure.
- `maint-rust` runs as a systemd service. Nginx reverse-proxies `/api/maint/*` to `127.0.0.1:8090` (or whatever port; configurable via env).
- Postgres database `apex_maint` (separate from Falcon's database) on the same Postgres instance. Same user/auth, different DB.
- Redis: reuse Falcon's existing Redis if any, else a separate redis instance on `127.0.0.1:6379` with a key prefix `maint:` for namespace isolation.

---

## 3. Authentication & authorization

### 3.1 Login flow (desktop)

```
1. App boots. Reads JWT from OS keyring.
2. If JWT exists and exp > now() + 60s buffer → skip to "Authenticated" state.
3. Otherwise show Login screen:
     POST https://apextransport.ddns.net/api/go/api/login
     Body: { "email": "<entered>", "password": "<entered>" }
4. On 200, response body contains:
     { "id", "email", "name", "permission", "driver_id", "jwt", "success" }
5. Store `jwt` in OS keyring under key "apex_maintenance.jwt".
6. Decode JWT to read `exp` (Unix seconds). Store alongside.
7. Transition to Authenticated state.
8. From now on, every HTTP request to maint-rust includes:
     Authorization: Bearer <jwt>
```

### 3.2 Token expiry

- No refresh endpoint. When `exp` passes, the app intercepts the next 401 response, drops to the Login screen, and the user re-authenticates.
- While offline with an expired token, the app continues to function in **read-only-with-pending-writes** mode: cached data is visible, writes go to the outbox, and a warning banner says "انتهت صلاحية الجلسة. الكتابات في الانتظار حتى تسجيل الدخول مرة أخرى." When the user logs in again, the outbox flushes.

### 3.3 Logout flow

```
1. User clicks Logout.
2. POST https://apextransport.ddns.net/api/go/api/logout (Bearer JWT).
3. Regardless of response, delete JWT from keyring.
4. Clear all cache tables in SQLite (vehicles, drivers, service invoices).
   Do NOT clear owned-data tables — they belong to the user, not the session.
5. Navigate to Login screen.
```

### 3.4 maint-rust auth middleware

Every endpoint except `/health` requires a valid JWT.

```rust
// Pseudocode
fn auth_middleware(req: HttpRequest) -> Result<AuthClaims> {
    let bearer = req.headers().get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .ok_or(Unauthorized)?;

    let claims: AuthClaims = jsonwebtoken::decode(
        bearer,
        &DecodingKey::from_secret(env::var("JWT_SECRET")?.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )?.claims;

    // Insert into request extensions for handler access
    req.extensions_mut().insert(claims.clone());
    Ok(claims)
}

#[derive(Deserialize, Clone)]
struct AuthClaims {
    user_type: String,    // "admin_user", "driver", etc.
    user_id: i64,         // Falcon's user.ID
    driver_id: i64,       // 0 if not a driver
    permission: i32,      // 0..=4 in Falcon's scheme
    iss: String,          // user_id as string (Falcon quirk)
    exp: i64,
}
```

### 3.5 Permission policy (v1)

**Single-tenant, single-trust-level for now.** Any valid JWT can do anything. The `permission` claim is captured into request context but not gated against. Plumbing it into context costs nothing now and saves a refactor when role-based access becomes a requirement.

### 3.6 Audit columns

Every owned-data row records `created_by_user_id` and `updated_by_user_id` populated from `claims.user_id` on the server side. The client never sends these — they're stamped at handler entry to prevent forgery.

---

## 4. External API integrations

### 4.1 Falcon `/api/cars`

```
GET https://apextransport.ddns.net/api/go/api/cars
Authorization: Bearer <jwt>

Response: JSON array of car objects (see /docs/falcon-cars-sample.json for shape).
```

**Cache strategy:**
- Initial fetch: full payload, upsert all rows into `vehicles_cache` and extract nested `driver` objects into `drivers_cache`.
- Periodic refresh: every 60 seconds while the app is in foreground and online.
- Cars present in cache but missing from response → `source_deleted_at = now()` (Falcon-side soft delete).
- The `last_fuel_odometer` field per car drives the live "current odometer" calculation in combination with the manual override.

**maint-rust proxy endpoint** (so the desktop never talks to Falcon directly):

```
GET /api/maint/cache/vehicles
Authorization: Bearer <jwt>
Response: { vehicles: [...], drivers: [...], fetched_at: "<iso>" }
```

`maint-rust` Redis-caches Falcon's response for 30 seconds to avoid hammering Falcon when multiple clients refresh simultaneously. Cache key: `maint:falcon:cars`.

### 4.2 Falcon `/api/service-invoices`

```
GET /api/go/api/service-invoices?page=N&limit=M
Authorization: Bearer <jwt>

Response: { data: [...], message, pagination: { limit, page, total, totalPages } }
```

**Cache strategy:**
- Initial sync: walk pages with `limit=100` until done. ~321 records / 100 = 4 requests.
- Incremental sync: fetch page 1 with `limit=20`. If all returned IDs are already in cache, stop. Else paginate back until first fully-known page.
- Both `service_invoices_cache` and `service_invoice_items_cache` are upserted in the same transaction.

**maint-rust proxy endpoint:**

```
GET /api/maint/cache/service-invoices?page=N&limit=M
GET /api/maint/cache/service-invoices/sync   (returns delta since last cursor)
```

### 4.3 Falcon `/api/service-invoices/search`

```
GET /api/go/api/service-invoices/search?query=<text>&page=N&limit=M
Authorization: Bearer <jwt>

Response: {
  invoice_count, total_matches, search_time, query, success,
  pagination: { ... },
  results: [
    {
      id, date, meter_reading, plate_number, driver_name,
      supervisor, operating_region, match_count,
      car: { id, plate_number, car_type, transporter, tank_capacity },
      inspection_items: [
        { id, service, notes, item_order, matched, distance, match_type }
      ]
    }
  ]
}
```

**Online behavior:** proxy directly via `GET /api/maint/cache/service-invoices/search?query=...&page=...&limit=...`. Server-side fuzzy ranking is preserved. No client-side caching of search results — they're query-dependent.

**Offline behavior:** the SQLite mirror has a virtual FTS5 table over `service_invoice_items_cache.service`. Query that locally with `MATCH` and join back to invoices. Results are unranked (or BM25-ranked but won't match server's ranking exactly). The UI displays a banner: **"بحث محدود (دون اتصال) — قد لا تظهر بعض النتائج."**

```sql
-- SQLite FTS5 setup (run once at init)
CREATE VIRTUAL TABLE service_invoice_items_fts USING fts5(
    service,
    notes,
    content='service_invoice_items_cache',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);

-- Triggers to keep FTS in sync with the cache table
CREATE TRIGGER siic_ai AFTER INSERT ON service_invoice_items_cache BEGIN
    INSERT INTO service_invoice_items_fts(rowid, service, notes)
    VALUES (new.id, new.service, new.notes);
END;
CREATE TRIGGER siic_au AFTER UPDATE ON service_invoice_items_cache BEGIN
    INSERT INTO service_invoice_items_fts(service_invoice_items_fts, rowid, service, notes)
    VALUES ('delete', old.id, old.service, old.notes);
    INSERT INTO service_invoice_items_fts(rowid, service, notes)
    VALUES (new.id, new.service, new.notes);
END;
CREATE TRIGGER siic_ad AFTER DELETE ON service_invoice_items_cache BEGIN
    INSERT INTO service_invoice_items_fts(service_invoice_items_fts, rowid, service, notes)
    VALUES ('delete', old.id, old.service, old.notes);
END;
```

---

## 5. Database — Postgres (server-side, owned by maint-rust)

All `gen_random_uuid()` calls require the `pgcrypto` extension. Enable it once:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### 5.1 Cache mirrors (read-only from the app's perspective)

```sql
-- =========================================================
-- vehicles_cache: mirror of Falcon /api/cars
-- =========================================================
CREATE TABLE vehicles_cache (
    id                              INT PRIMARY KEY,
    car_no_plate                    TEXT NOT NULL,
    car_type                        TEXT,
    transporter                     TEXT,
    tank_capacity                   INT,
    json_compartments               JSONB,
    license_expiration_date         DATE,
    calibration_expiration_date     DATE,
    tank_license_expiration_date    DATE,
    is_in_trip                      BOOLEAN NOT NULL DEFAULT FALSE,
    is_approved                     BOOLEAN NOT NULL DEFAULT FALSE,
    location                        TEXT,
    lat                             NUMERIC(10, 7),
    long                            NUMERIC(10, 7),
    location_time_stamp             TIMESTAMPTZ,
    engine_status                   TEXT,
    speed                           INT,
    last_fuel_odometer              INT,
    last_oil_change_id              INT,
    driver_id                       INT,
    operating_company               TEXT,
    operating_area                  TEXT,
    geo_fence                       TEXT,
    slack_status                    TEXT,
    last_updated_slack_status       TIMESTAMPTZ,
    etit_car_id                     TEXT,
    car_license_url                 TEXT,
    car_license_back_url            TEXT,
    calibration_license_url         TEXT,
    calibration_license_back_url    TEXT,
    tank_license_url                TEXT,
    tank_license_back_url           TEXT,
    raw_payload                     JSONB NOT NULL,
    source_created_at               TIMESTAMPTZ,
    source_updated_at               TIMESTAMPTZ,
    source_deleted_at               TIMESTAMPTZ,
    fetched_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vehicles_cache_plate  ON vehicles_cache(car_no_plate);
CREATE INDEX idx_vehicles_cache_active ON vehicles_cache(id) WHERE source_deleted_at IS NULL;

-- =========================================================
-- drivers_cache: extracted from nested driver field
-- =========================================================
CREATE TABLE drivers_cache (
    id                                  INT PRIMARY KEY,
    name                                TEXT NOT NULL,
    mobile_number                       TEXT,
    transporter                         TEXT,
    id_license_expiration_date          DATE,
    driver_license_expiration_date      DATE,
    safety_license_expiration_date      DATE,
    drug_test_expiration_date           DATE,
    is_approved                         BOOLEAN NOT NULL DEFAULT FALSE,
    raw_payload                         JSONB NOT NULL,
    source_created_at                   TIMESTAMPTZ,
    source_updated_at                   TIMESTAMPTZ,
    fetched_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- service_invoices_cache: mirror of Falcon /api/service-invoices
-- =========================================================
CREATE TABLE service_invoices_cache (
    id                          INT PRIMARY KEY,
    car_id                      INT NOT NULL,
    driver_name                 TEXT,
    date                        TIMESTAMPTZ,
    meter_reading               INT,
    plate_number                TEXT,
    supervisor                  TEXT,
    operating_region            TEXT,
    raw_payload                 JSONB NOT NULL,
    source_created_at           TIMESTAMPTZ,
    source_updated_at           TIMESTAMPTZ,
    source_deleted_at           TIMESTAMPTZ,
    fetched_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_cache_car   ON service_invoices_cache(car_id);
CREATE INDEX idx_invoices_cache_date  ON service_invoices_cache(date DESC);

CREATE TABLE service_invoice_items_cache (
    id                          INT PRIMARY KEY,
    service_invoice_id          INT NOT NULL,
    service                     TEXT NOT NULL,
    notes                       TEXT,
    item_order                  INT,
    raw_payload                 JSONB NOT NULL,
    source_created_at           TIMESTAMPTZ,
    source_updated_at           TIMESTAMPTZ,
    fetched_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoice_items_invoice ON service_invoice_items_cache(service_invoice_id);
```

### 5.2 Owned data — maintenance scheduling

```sql
-- =========================================================
-- maintenance_categories: lookup, bilingual at row level
-- =========================================================
CREATE TABLE maintenance_categories (
    id                      TEXT PRIMARY KEY,         -- 'oil_change', 'brakes', etc.
    name_ar                 TEXT NOT NULL,
    name_en                 TEXT NOT NULL,
    icon                    TEXT,                     -- lucide icon name
    color                   TEXT,                     -- tailwind color token
    sort_order              SMALLINT NOT NULL DEFAULT 0
);

-- Seed rows (run as part of migrations):
INSERT INTO maintenance_categories (id, name_ar, name_en, icon, color, sort_order) VALUES
  ('oil_change',           'تغيير زيت',          'Oil Change',          'droplet',     'amber',  10),
  ('air_filter',           'فلتر هواء',           'Air Filter',          'wind',        'sky',    20),
  ('fuel_filter',          'فلتر سولار',          'Fuel Filter',         'fuel',        'orange', 30),
  ('oil_filter',           'فلتر زيت',            'Oil Filter',          'filter',      'amber',  40),
  ('brakes',               'فرامل',              'Brakes',              'octagon',     'red',    50),
  ('coolant',              'مياه تبريد',         'Coolant',             'thermometer', 'cyan',   60),
  ('transmission',         'زيت فتيس',           'Transmission Oil',    'cog',         'violet', 70),
  ('battery',              'بطارية',             'Battery',             'battery',     'green',  80),
  ('inspection',           'فحص دوري',           'Periodic Inspection', 'clipboard',   'slate',  90),
  ('greasing',             'تشحيم',              'Greasing',            'wrench',      'zinc',   100);

-- =========================================================
-- maintenance_templates: the rule
-- =========================================================
CREATE TYPE maintenance_trigger AS ENUM ('mileage', 'time');

CREATE TABLE maintenance_templates (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id              INT NOT NULL,
    category_id             TEXT NOT NULL REFERENCES maintenance_categories(id),
    name_ar                 TEXT NOT NULL,
    name_en                 TEXT NOT NULL,
    notes_ar                TEXT,
    notes_en                TEXT,
    trigger_type            maintenance_trigger NOT NULL,
    interval_km             INT,
    interval_days           INT,
    lead_warn_km            INT NOT NULL DEFAULT 500,
    lead_warn_days          INT NOT NULL DEFAULT 14,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,
    created_by_user_id      BIGINT NOT NULL,
    updated_by_user_id      BIGINT NOT NULL,
    sync_version            BIGINT NOT NULL DEFAULT 1,
    CHECK (
        (trigger_type = 'mileage' AND interval_km  IS NOT NULL AND interval_km  > 0) OR
        (trigger_type = 'time'    AND interval_days IS NOT NULL AND interval_days > 0)
    )
);
CREATE INDEX idx_templates_vehicle ON maintenance_templates(vehicle_id) WHERE deleted_at IS NULL;

-- =========================================================
-- maintenance_records: the event
-- =========================================================
CREATE TABLE maintenance_records (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id             UUID REFERENCES maintenance_templates(id),  -- NULL = ad-hoc
    vehicle_id              INT NOT NULL,
    category_id             TEXT NOT NULL REFERENCES maintenance_categories(id),
    performed_at            TIMESTAMPTZ NOT NULL,
    odometer_at_service     INT,
    next_due_at             TIMESTAMPTZ,
    next_due_km             INT,
    cost                    NUMERIC(12, 2),
    vendor                  TEXT,
    performed_by            TEXT,
    notes                   TEXT,
    attachments             JSONB NOT NULL DEFAULT '[]',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,
    created_by_user_id      BIGINT NOT NULL,
    updated_by_user_id      BIGINT NOT NULL,
    sync_version            BIGINT NOT NULL DEFAULT 1
);
CREATE INDEX idx_records_vehicle_date ON maintenance_records(vehicle_id, performed_at DESC);
CREATE INDEX idx_records_template     ON maintenance_records(template_id) WHERE deleted_at IS NULL;

-- =========================================================
-- vehicle_odometer_overrides: manual override per vehicle
-- =========================================================
CREATE TABLE vehicle_odometer_overrides (
    vehicle_id              INT PRIMARY KEY,
    odometer                INT NOT NULL CHECK (odometer >= 0),
    set_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by_user_id      BIGINT NOT NULL,
    updated_by_user_id      BIGINT NOT NULL,
    sync_version            BIGINT NOT NULL DEFAULT 1
);
```

### 5.3 Owned data — chassis & tires

```sql
-- =========================================================
-- chassis_layouts: one per vehicle
-- =========================================================
CREATE TABLE chassis_layouts (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id              INT NOT NULL UNIQUE,
    name_ar                 TEXT,
    name_en                 TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,
    created_by_user_id      BIGINT NOT NULL,
    updated_by_user_id      BIGINT NOT NULL,
    sync_version            BIGINT NOT NULL DEFAULT 1
);

-- =========================================================
-- chassis_axles: ordered list, tractor + trailer sections
-- =========================================================
CREATE TYPE chassis_section AS ENUM ('tractor', 'trailer');
CREATE TYPE axle_type       AS ENUM ('single', 'dual');

CREATE TABLE chassis_axles (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layout_id               UUID NOT NULL REFERENCES chassis_layouts(id) ON DELETE CASCADE,
    section                 chassis_section NOT NULL,
    section_index           SMALLINT NOT NULL,
    axle_type               axle_type NOT NULL,
    label_ar                TEXT,
    label_en                TEXT,
    is_steering             BOOLEAN NOT NULL DEFAULT FALSE,
    is_lifted               BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (layout_id, section, section_index)
);

-- =========================================================
-- chassis_positions: enumerated per axle, plus spare slots
-- =========================================================
CREATE TYPE position_side  AS ENUM ('left', 'right');
CREATE TYPE position_depth AS ENUM ('single', 'inner', 'outer');

CREATE TABLE chassis_positions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layout_id               UUID NOT NULL REFERENCES chassis_layouts(id) ON DELETE CASCADE,
    axle_id                 UUID REFERENCES chassis_axles(id) ON DELETE CASCADE,
    side                    position_side,
    depth                   position_depth,
    is_spare                BOOLEAN NOT NULL DEFAULT FALSE,
    spare_index             SMALLINT,
    position_code           TEXT NOT NULL,            -- 'H1L', 'TR2RO', 'SP1', etc.
    UNIQUE (layout_id, position_code),
    CHECK (
        (is_spare = FALSE AND axle_id IS NOT NULL AND side IS NOT NULL AND depth IS NOT NULL)
     OR (is_spare = TRUE  AND axle_id IS NULL     AND spare_index IS NOT NULL)
    )
);
CREATE INDEX idx_positions_layout ON chassis_positions(layout_id);
CREATE INDEX idx_positions_axle   ON chassis_positions(axle_id);

-- =========================================================
-- tires: first-class assets, lifecycle tracked
-- =========================================================
CREATE TYPE tire_status AS ENUM
    ('in_stock', 'mounted', 'in_repair', 'retreading', 'scrapped');

CREATE TABLE tires (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dot_code                TEXT NOT NULL UNIQUE,
    internal_serial         TEXT,
    brand                   TEXT NOT NULL,
    model                   TEXT,
    purchase_date           DATE,
    purchase_cost           NUMERIC(12, 2),
    supplier                TEXT,
    -- DOT date (4-char "WWYY" e.g. "4523" = week 45, year 2023)
    production_week         SMALLINT CHECK (production_week  BETWEEN 1 AND 53),
    production_year         SMALLINT CHECK (production_year  BETWEEN 2000 AND 2099),
    production_date         DATE,                     -- ISO Monday of week N year YYYY
    is_retread              BOOLEAN NOT NULL DEFAULT FALSE,
    retread_count           SMALLINT NOT NULL DEFAULT 0,
    parent_tire_id          UUID REFERENCES tires(id),
    status                  tire_status NOT NULL DEFAULT 'in_stock',
    stock_location          TEXT,
    scrap_reason            TEXT,
    scrap_date              DATE,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,
    created_by_user_id      BIGINT NOT NULL,
    updated_by_user_id      BIGINT NOT NULL,
    sync_version            BIGINT NOT NULL DEFAULT 1,
    CHECK ((production_week IS NULL) = (production_year IS NULL))
);
CREATE INDEX idx_tires_dot              ON tires(dot_code);
CREATE INDEX idx_tires_status_brand     ON tires(status, brand) WHERE deleted_at IS NULL;
CREATE INDEX idx_tires_stock_location   ON tires(stock_location)
    WHERE deleted_at IS NULL AND status = 'in_stock';
CREATE INDEX idx_tires_production       ON tires(production_year, production_week);

-- =========================================================
-- tire_assignments: every mount/dismount event
-- =========================================================
CREATE TYPE mount_reason AS ENUM (
    'new_install', 'rotation', 'replacement',
    'puncture', 'wear', 'damage', 'retread_return'
);

CREATE TABLE tire_assignments (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tire_id                 UUID NOT NULL REFERENCES tires(id),
    position_id             UUID NOT NULL REFERENCES chassis_positions(id),
    vehicle_id              INT NOT NULL,
    mounted_at              TIMESTAMPTZ NOT NULL,
    mounted_odometer        INT,
    dismounted_at           TIMESTAMPTZ,
    dismounted_odometer     INT,
    mount_reason            mount_reason NOT NULL,
    dismount_reason         mount_reason,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,
    created_by_user_id      BIGINT NOT NULL,
    updated_by_user_id      BIGINT NOT NULL,
    sync_version            BIGINT NOT NULL DEFAULT 1,
    CHECK (dismounted_at IS NULL OR dismounted_at >= mounted_at),
    CHECK (
        dismounted_odometer IS NULL OR mounted_odometer IS NULL
        OR dismounted_odometer >= mounted_odometer
    )
);
CREATE INDEX idx_assignments_tire     ON tire_assignments(tire_id);
CREATE INDEX idx_assignments_position ON tire_assignments(position_id);
CREATE INDEX idx_assignments_vehicle  ON tire_assignments(vehicle_id);

-- A position holds at most one tire at a time
CREATE UNIQUE INDEX idx_assignments_one_active_per_position
    ON tire_assignments(position_id) WHERE dismounted_at IS NULL AND deleted_at IS NULL;
-- A tire is mounted in at most one place
CREATE UNIQUE INDEX idx_assignments_one_active_per_tire
    ON tire_assignments(tire_id) WHERE dismounted_at IS NULL AND deleted_at IS NULL;
```

### 5.4 Views

```sql
-- =========================================================
-- v_maintenance_due: live status per active template
-- =========================================================
CREATE OR REPLACE VIEW v_maintenance_due AS
SELECT
    t.id              AS template_id,
    t.vehicle_id,
    t.category_id,
    t.name_ar, t.name_en,
    t.trigger_type,
    t.interval_km, t.interval_days,
    t.lead_warn_km, t.lead_warn_days,
    r.performed_at        AS last_done_at,
    r.odometer_at_service AS last_done_km,
    r.next_due_at,
    r.next_due_km,
    GREATEST(
        COALESCE(vc.last_fuel_odometer, 0),
        COALESCE(voo.odometer, 0)
    ) AS current_odometer,
    CASE
        WHEN COALESCE(voo.odometer, 0) > COALESCE(vc.last_fuel_odometer, 0)
            THEN 'manual'
        ELSE 'falcon'
    END AS odometer_source,
    CASE
      WHEN r.id IS NULL THEN 'never_done'
      WHEN t.trigger_type = 'mileage' AND r.next_due_km IS NOT NULL THEN
        CASE
          WHEN GREATEST(COALESCE(vc.last_fuel_odometer, 0), COALESCE(voo.odometer, 0)) >= r.next_due_km
            THEN 'overdue'
          WHEN GREATEST(COALESCE(vc.last_fuel_odometer, 0), COALESCE(voo.odometer, 0)) >= r.next_due_km - t.lead_warn_km
            THEN 'due_soon'
          ELSE 'ok'
        END
      WHEN t.trigger_type = 'time' AND r.next_due_at IS NOT NULL THEN
        CASE
          WHEN now() >= r.next_due_at THEN 'overdue'
          WHEN now() >= r.next_due_at - (t.lead_warn_days || ' days')::INTERVAL THEN 'due_soon'
          ELSE 'ok'
        END
      ELSE 'never_done'
    END AS status
FROM maintenance_templates t
LEFT JOIN LATERAL (
    SELECT * FROM maintenance_records
    WHERE template_id = t.id AND deleted_at IS NULL
    ORDER BY performed_at DESC LIMIT 1
) r ON TRUE
JOIN vehicles_cache vc                    ON vc.id = t.vehicle_id
LEFT JOIN vehicle_odometer_overrides voo  ON voo.vehicle_id = t.vehicle_id
WHERE t.deleted_at IS NULL
  AND t.is_active
  AND vc.source_deleted_at IS NULL;

-- =========================================================
-- v_tire_lifetime: aggregate metrics per tire
-- =========================================================
CREATE OR REPLACE VIEW v_tire_lifetime AS
WITH per_assignment_km AS (
    SELECT
        ta.id,
        ta.tire_id,
        ta.vehicle_id,
        ta.mounted_at,
        CASE
          WHEN ta.dismounted_odometer IS NOT NULL AND ta.mounted_odometer IS NOT NULL
            THEN ta.dismounted_odometer - ta.mounted_odometer
          WHEN ta.dismounted_at IS NULL AND ta.mounted_odometer IS NOT NULL
            THEN GREATEST(
                   COALESCE(vc.last_fuel_odometer, ta.mounted_odometer),
                   COALESCE(voo.odometer,         ta.mounted_odometer)
                 ) - ta.mounted_odometer
          ELSE 0
        END AS km_on_position
    FROM tire_assignments ta
    LEFT JOIN vehicles_cache vc               ON vc.id  = ta.vehicle_id
    LEFT JOIN vehicle_odometer_overrides voo  ON voo.vehicle_id = ta.vehicle_id
    WHERE ta.deleted_at IS NULL
)
SELECT
    t.id                                    AS tire_id,
    t.dot_code,
    t.brand,
    t.status,
    t.purchase_cost,
    COALESCE(SUM(pa.km_on_position), 0)::INT AS lifetime_km,
    COUNT(pa.id)::INT                        AS installment_count,
    MIN(pa.mounted_at)                       AS first_mounted_at,
    CASE
      WHEN t.purchase_cost IS NOT NULL AND COALESCE(SUM(pa.km_on_position), 0) > 0
        THEN ROUND(t.purchase_cost / NULLIF(SUM(pa.km_on_position), 0), 4)
      ELSE NULL
    END                                      AS cost_per_km
FROM tires t
LEFT JOIN per_assignment_km pa ON pa.tire_id = t.id
WHERE t.deleted_at IS NULL
GROUP BY t.id, t.dot_code, t.brand, t.status, t.purchase_cost;

-- =========================================================
-- v_tires_list: list view with current location + lifetime metrics
-- =========================================================
CREATE OR REPLACE VIEW v_tires_list AS
SELECT
    t.id,
    t.dot_code,
    t.internal_serial,
    t.brand,
    t.model,
    t.status,
    t.production_week,
    t.production_year,
    t.production_date,
    t.purchase_date,
    t.purchase_cost,
    t.stock_location,
    t.is_retread,
    t.retread_count,
    CASE
      WHEN t.status = 'mounted' THEN
        (SELECT vc.car_no_plate || ' / ' || cp.position_code
           FROM tire_assignments ta
           JOIN chassis_positions cp ON cp.id = ta.position_id
           JOIN vehicles_cache vc    ON vc.id = ta.vehicle_id
          WHERE ta.tire_id = t.id AND ta.dismounted_at IS NULL AND ta.deleted_at IS NULL
          LIMIT 1)
      WHEN t.status = 'in_stock' THEN COALESCE(t.stock_location, 'Unassigned')
      ELSE t.status::TEXT
    END AS current_location_label,
    EXISTS (
        SELECT 1 FROM tire_assignments ta
        WHERE ta.tire_id = t.id AND ta.deleted_at IS NULL
    ) AS has_history,
    tl.lifetime_km,
    tl.installment_count,
    tl.cost_per_km,
    t.created_at,
    t.updated_at
FROM tires t
LEFT JOIN v_tire_lifetime tl ON tl.tire_id = t.id
WHERE t.deleted_at IS NULL;
```

---

## 6. Database — SQLite (client-side mirror)

The local SQLite database lives at `<app-data>/apex_maintenance.db`. Schema is structurally identical to Postgres with these substitutions:

| Postgres | SQLite |
|---|---|
| `UUID` | `TEXT` (stored as 36-char string) |
| `JSONB` | `TEXT` (stored as JSON string, parsed in Rust/JS) |
| `TIMESTAMPTZ` | `TEXT` (stored as ISO-8601 UTC) |
| `DATE` | `TEXT` (stored as `YYYY-MM-DD`) |
| `NUMERIC` | `REAL` |
| `BIGINT` | `INTEGER` |
| `gen_random_uuid()` | UUIDv4 generated client-side before insert |
| Enums (`tire_status`, etc.) | `TEXT CHECK (col IN ('a','b',...))` |
| `now()` | datetime in app code, stored as ISO-8601 |

Views (`v_maintenance_due`, `v_tire_lifetime`, `v_tires_list`) are recreated locally with equivalent SQL using SQLite functions (`MAX()` instead of `GREATEST()`, `julianday()` for date math, etc.).

### 6.1 Sync infrastructure tables (SQLite-only)

```sql
CREATE TABLE sync_outbox (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    operation       TEXT NOT NULL CHECK (operation IN ('insert','update','delete')),
    payload_json    TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    attempted_at    TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT
);
CREATE INDEX idx_outbox_pending ON sync_outbox(created_at) WHERE attempts < 5;

CREATE TABLE sync_cursors (
    entity_type     TEXT PRIMARY KEY,
    last_pulled_at  TEXT NOT NULL,
    last_pushed_at  TEXT
);

CREATE TABLE cache_freshness (
    cache_name      TEXT PRIMARY KEY,
    fetched_at      TEXT NOT NULL,
    ttl_seconds     INTEGER NOT NULL,
    is_stale        INTEGER NOT NULL DEFAULT 0
);
```

---

## 7. Sync protocol

### 7.1 Principles

- **Owned data syncs bidirectionally.** Client writes go to the outbox; server pushes back via cursor-based pulls.
- **Cache data syncs one-way (server → client).** No cache mutations originate locally.
- **`sync_version` is server-authoritative.** The server increments on every accepted write. Clients send their `sync_version` along with updates; the server rejects with 409 if the client's version is stale.
- **UUIDs generated client-side.** No round-trip needed for primary keys. Collisions are statistically impossible.
- **Soft deletes only.** All "delete" operations set `deleted_at = now()`; nothing is physically deleted.

### 7.2 Push cycle (client → server)

Triggered: every 30 seconds while online + immediately after any local mutation.

```
1. Read all sync_outbox rows where attempts < 5, ORDER BY created_at ASC.
2. Group consecutive ops by (entity_type, batch_size=50).
3. POST /api/maint/sync/push
     { operations: [
         { entity_type, entity_id, operation, payload, sync_version }
       ]
     }
4. For each operation, server returns:
     { entity_id, status: "applied" | "conflict" | "error", new_sync_version }
5. On 'applied': delete outbox row. Update local row's sync_version.
6. On 'conflict' (server has higher sync_version): the user's change is stale.
     Pull the server version, present to user, ask whether to discard or retry.
7. On 'error' (validation): mark outbox row as failed (max attempts), surface to user.
```

### 7.3 Pull cycle (server → client)

Triggered: every 60 seconds while online + after any push completes + on app open.

```
For each entity_type in [
    'maintenance_templates', 'maintenance_records', 'chassis_layouts',
    'chassis_axles', 'chassis_positions', 'tires', 'tire_assignments',
    'vehicle_odometer_overrides'
]:
    1. Read sync_cursors.last_pulled_at for this entity_type (default: epoch).
    2. GET /api/maint/sync/pull?entity_type=X&since=<cursor>&limit=200
    3. Server responds with all rows where updated_at > since (incl. deletions).
    4. Upsert each row into local table, preserving sync_version.
    5. Update cursor to MAX(updated_at) of returned rows.
    6. Repeat with new cursor until response is empty.
```

### 7.4 Cache refresh (one-way)

```
vehicles_cache, drivers_cache:
    GET /api/maint/cache/vehicles every 60s while foreground.
    Replace local rows entirely (it's small).

service_invoices_cache, service_invoice_items_cache:
    GET /api/maint/cache/service-invoices/sync (returns delta).
    Upsert; never delete (historical record).

cache_freshness rows updated on every successful refresh.
```

### 7.5 Conflict UX

When a 409 conflict surfaces, present the user with:

```
┌──────────────────────────────────────────────────────────┐
│  ⚠ تعارض في البيانات                                       │
├──────────────────────────────────────────────────────────┤
│  حدّثت هذا السجل بينما كان شخص آخر يحدّثه أيضاً.            │
│                                                          │
│  [تعديلك]               [النسخة على الخادم]               │
│  الكيلومترات: 165,000   الكيلومترات: 168,000              │
│  التاريخ: ٢٠٢٦/٠٤/٢٨    التاريخ: ٢٠٢٦/٠٥/٠١              │
│                                                          │
│  [إلغاء تعديلي]  [إعادة المحاولة بالقيم الحالية]          │
└──────────────────────────────────────────────────────────┘
```

This is the only conflict-resolution UX. Last-write-wins automatic resolution is **forbidden** — silent overwrites of someone else's work erode trust faster than any other class of bug.

---

## 8. Maintenance scheduling logic

### 8.1 Conceptual model

- **Template** = the rule. One per (vehicle, category, trigger). Pure mileage OR pure time.
- **Record** = the event. Marks "this maintenance was performed at this odometer / date." Caches `next_due_km` / `next_due_at` at insert time.
- **Status** = derived. Computed live by `v_maintenance_due` from latest record + current odometer + `now()`.

### 8.2 Status state machine

```
  ┌───────────┐    no records exist
  │never_done │←──────────────────────┐
  └───────────┘                       │
        │                             │
        │ first record inserted       │
        ▼                             │
  ┌───────────┐                       │
  │    ok     │                       │
  └───────────┘                       │
        │                             │
        │ current odometer ≥ next_due_km - lead_warn_km
        │ OR  now() ≥ next_due_at - lead_warn_days
        ▼                             │
  ┌───────────┐                       │
  │ due_soon  │                       │
  └───────────┘                       │
        │                             │
        │ current odometer ≥ next_due_km
        │ OR  now() ≥ next_due_at
        ▼                             │
  ┌───────────┐    new record inserted │
  │  overdue  │───────────────────────┘
  └───────────┘
```

### 8.3 Mark Done flow

```
User clicks "Mark Done" on a row in v_maintenance_due:

1. Modal opens:
   ┌────────────────────────────────────────────┐
   │  تسجيل تنفيذ الصيانة                          │
   ├────────────────────────────────────────────┤
   │  التاريخ:        [اليوم ▾]   ← max=today    │
   │  قراءة العداد:   [_______] كم  ← REQUIRED   │
   │  التكلفة:        [_______] ج.م  ← optional │
   │  المنفذ:         [_______]      ← optional │
   │  ملاحظات:        [_______]      ← optional │
   │                                            │
   │  [إلغاء]                          [تسجيل] │
   └────────────────────────────────────────────┘

2. On submit:
   - Validate performed_at <= now() (handler-layer in maint-rust).
   - Compute next_due_km / next_due_at from template's interval.
   - INSERT maintenance_records.
   - Outbox push fires immediately if online.

3. v_maintenance_due re-renders, status flips to 'ok'.
```

### 8.4 Odometer override

```
Truck detail page shows a card:
   ┌─────────────────────────────────────────────┐
   │  الكيلومترات الحالية                          │
   │                                             │
   │  ١٦٥٫٠٠٠ كم   ← effective, large           │
   │  المصدر: تعديل يدوي • ٢٠٢٦/٠٤/٢٨            │
   │  فالكون: ١٦٢٫٣٤٠ كم                          │
   │                                             │
   │              [تعديل يدوي]                    │
   └─────────────────────────────────────────────┘

When user clicks "تعديل يدوي":
   ┌─────────────────────────────────────────────┐
   │  تعديل قراءة العداد يدويًا                     │
   │                                             │
   │  القراءة الجديدة: [_____] كم                 │
   │  ملاحظات:        [_____]                     │
   │                                             │
   │  [إلغاء]                          [حفظ]   │
   └─────────────────────────────────────────────┘

UPSERT into vehicle_odometer_overrides.
v_maintenance_due picks it up immediately via GREATEST().
```

---

## 9. Tire engine

### 9.1 Diagram rendering

```
GET /api/maint/chassis/{vehicle_id}/full

Response:
{
  "layout": { "id", "name_ar", "name_en", "vehicle_id" },
  "sections": [
    {
      "section": "tractor",
      "axles": [
        {
          "id", "section_index": 1, "axle_type": "single",
          "label_ar": "توجيه", "label_en": "Steering",
          "is_steering": true, "is_lifted": false,
          "positions": [
            { "id", "position_code": "H1L", "side": "left",  "depth": "single",
              "tire": { "id", "dot_code", "brand", "production_year", "production_week" } | null
            },
            { "id", "position_code": "H1R", "side": "right", "depth": "single", "tire": ... }
          ]
        },
        { "section_index": 2, "axle_type": "dual", "positions": [/* 4 entries */] },
        ...
      ]
    },
    { "section": "trailer", "axles": [...] }
  ],
  "spares": [
    { "id", "position_code": "SP1", "spare_index": 1, "tire": {...} | null },
    { "id", "position_code": "SP2", "spare_index": 2, "tire": null }
  ]
}
```

The frontend renders this as a top-down vertical stack. CSS grid handles axle width based on `axle_type`. Position cards are tap targets — clicking opens the tire detail drawer.

```
Visual structure (RTL flipped at render time):

    ┌─────────────────┐
    │   TRACTOR HEAD  │
    │  ┌───┐     ┌───┐│   axle 1 (single)
    │  │H1L│     │H1R││
    │  └───┘     └───┘│
    │┌───┬───┐ ┌───┬───┐│ axle 2 (dual)
    ││H2LO│H2LI│ │H2RI│H2RO││
    │└───┴───┘ └───┴───┘│
    └────────┬────────┘
             │  hitch line
    ┌────────┴────────┐
    │     TRAILER     │
    │┌───┬───┐ ┌───┬───┐│ trailer axle 1
    │└───┴───┘ └───┴───┘│
    │┌───┬───┐ ┌───┬───┐│ trailer axle 2
    │└───┴───┘ └───┴───┘│
    │┌───┬───┐ ┌───┬───┐│ trailer axle 3
    │└───┴───┘ └───┴───┘│
    └─────────────────┘

    Spares row (separate, below):
    ┌───┐ ┌───┐
    │SP1│ │SP2│
    └───┘ └───┘
```

Empty positions render with dashed border. Filled positions show tire brand + DOT code. **No status colors.**

### 9.2 Position code generation

When a layout's axles/positions are created, generate `position_code` deterministically:

```
Tractor axle N, single:    H{N}L, H{N}R
Tractor axle N, dual:      H{N}LO, H{N}LI, H{N}RI, H{N}RO
Trailer axle N, single:    TR{N}L, TR{N}R
Trailer axle N, dual:      TR{N}LO, TR{N}LI, TR{N}RI, TR{N}RO
Spare N:                   SP{N}
```

Codes are stable for the life of the layout. If an axle is deleted and recreated, codes can be reused. The combination `(layout_id, position_code)` is UNIQUE.

### 9.3 DOT date input

```
UI:
  DOT Code:        [DOT _____________]  (the full code as printed)
  Date code WWYY:  [____]  ← exactly 4 digits

  Live preview: "الأسبوع ٤٥ من سنة ٢٠٢٣ — الإثنين ٢٠٢٣/١١/٠٦"

Validation (handler-layer):
  - Length must be 4
  - Both halves parse as integers
  - week ∈ [1, 53]
  - year_2 ∈ [00, 99] → year = 2000 + year_2
  - production_date = ISO Monday of week N year YYYY
  - production_date ≤ today
  - All optional; setting one of {week, year} requires both

Pseudocode for production_date computation:
  fn iso_week_monday(year: i32, week: u32) -> NaiveDate {
      // chrono's NaiveDate::from_isoywd does this directly:
      NaiveDate::from_isoywd_opt(year, week, Weekday::Mon).unwrap()
  }
```

### 9.4 Mount / dismount workflow

```
Single mount (from tire detail or position card):
  POST /api/maint/tires/{tire_id}/mount
  { position_id, mounted_at, mounted_odometer (optional), mount_reason, notes }

  Server:
    - Validate tire.status IN ('in_stock')
    - Validate position has no active assignment
    - Validate vehicle is not soft-deleted
    - INSERT tire_assignments
    - UPDATE tires.status = 'mounted'
    - Return updated tire + assignment

Single dismount:
  POST /api/maint/tires/assignments/{assignment_id}/dismount
  { dismounted_at, dismounted_odometer (optional), dismount_reason,
    destination: 'in_stock'|'in_repair'|'retreading'|'scrapped',
    scrap_reason (required if destination='scrapped') }

  Server:
    - UPDATE tire_assignments SET dismounted_at=..., dismounted_odometer=..., dismount_reason=...
    - UPDATE tires.status = destination
    - If scrapped, also set tires.scrap_reason and tires.scrap_date
    - Return updated tire + assignment
```

### 9.5 Bulk operations

```
POST /api/maint/tires/bulk
{
  "operations": [
    { "kind": "dismount", "assignment_id": "...", "dismounted_at": "...",
      "dismounted_odometer": 165000, "dismount_reason": "wear",
      "destination": "in_stock" },
    { "kind": "mount", "tire_id": "...", "position_id": "...",
      "mounted_at": "...", "mounted_odometer": 165000,
      "mount_reason": "replacement" },
    { "kind": "scrap", "tire_id": "...", "scrap_reason": "sidewall blowout",
      "scrap_date": "2026-05-04" },
    { "kind": "update_stock_location", "tire_id": "...",
      "stock_location": "Suez Depot" }
  ]
}

Response:
  200 OK     → { results: [{ kind, entity_id, success: true, data }] }
  409 Conflict → entire batch rolled back, response identifies failing op
```

Executed inside a single Postgres transaction. The order of operations in the array is the order of execution — so a dismount-then-mount of the same position works because the dismount completes first.

### 9.6 Tire history view

The tire detail drawer shows:

```
┌─────────────────────────────────────────────────────┐
│  إطار: DOT 4523ABC...                                │
│  ميشلان • XZA-2 • تركيب جديد ٢٠٢٤/٠٣/١٥             │
├─────────────────────────────────────────────────────┤
│  الإحصائيات                                           │
│    إجمالي المسافة:     87,400 كم                    │
│    عدد عمليات التركيب: 3                             │
│    التكلفة لكل كم:     ٠٫٠٤ ج.م                     │
├─────────────────────────────────────────────────────┤
│  السجل الكامل                                         │
│                                                     │
│  ▸ مركّب الآن — H2LO على ف د ى ٦٨٣٤                  │
│      من ٢٠٢٦/٠٢/١٠ • ١٤٥,٠٠٠ كم                    │
│      المسافة منذ التركيب: ٢٠,٠٠٠ كم                  │
│                                                     │
│  ▸ مفكوك — TR1RI على ف ا ن ٧٤٢١                     │
│      ٢٠٢٥/١١/٠٢ → ٢٠٢٦/٠٢/٠٥                        │
│      ١٢٠,٠٠٠ → ١٤٥,٠٠٠ كم  (٢٥,٠٠٠ كم)              │
│      السبب: تدوير                                    │
│                                                     │
│  ▸ ...                                              │
├─────────────────────────────────────────────────────┤
│   [نقل]    [فك]    [خردة]                            │
└─────────────────────────────────────────────────────┘
```

---

## 10. maint-rust project structure

```
maint-rust/
├── Cargo.toml
├── .env.example
├── migrations/
│   ├── 0001_init_extensions.sql
│   ├── 0002_cache_tables.sql
│   ├── 0003_maintenance_tables.sql
│   ├── 0004_chassis_tables.sql
│   ├── 0005_tire_tables.sql
│   ├── 0006_views.sql
│   └── 0007_seeds.sql
├── src/
│   ├── main.rs
│   ├── config.rs
│   ├── error.rs                      // unified ApiError + IntoResponse
│   ├── auth/
│   │   ├── mod.rs
│   │   ├── claims.rs                 // AuthClaims struct
│   │   ├── middleware.rs             // JWT verification
│   │   └── extractor.rs              // FromRequest impl
│   ├── db/
│   │   ├── mod.rs
│   │   └── pool.rs                   // SQLx pool init
│   ├── falcon/
│   │   ├── mod.rs
│   │   ├── client.rs                 // reqwest wrapper
│   │   ├── cars.rs                   // get_cars()
│   │   ├── invoices.rs               // get_invoices(), search_invoices()
│   │   ├── auth.rs                   // logout passthrough
│   │   └── cache.rs                  // Redis wrapper
│   ├── handlers/
│   │   ├── mod.rs
│   │   ├── health.rs
│   │   ├── cache_vehicles.rs         // GET /cache/vehicles
│   │   ├── cache_invoices.rs         // GET /cache/service-invoices*
│   │   ├── templates.rs              // CRUD on maintenance_templates
│   │   ├── records.rs                // CRUD on maintenance_records
│   │   ├── due.rs                    // GET /due (queries v_maintenance_due)
│   │   ├── overrides.rs              // upsert vehicle_odometer_overrides
│   │   ├── chassis.rs                // CRUD on layouts/axles/positions
│   │   ├── tires.rs                  // CRUD on tires + bulk endpoint
│   │   ├── assignments.rs            // mount/dismount endpoints
│   │   └── sync.rs                   // /sync/push, /sync/pull
│   ├── models/
│   │   ├── mod.rs
│   │   ├── vehicle.rs
│   │   ├── driver.rs
│   │   ├── invoice.rs
│   │   ├── template.rs
│   │   ├── record.rs
│   │   ├── chassis.rs
│   │   ├── tire.rs
│   │   └── assignment.rs
│   ├── services/
│   │   ├── mod.rs
│   │   ├── due_engine.rs             // calc next_due_km / next_due_at
│   │   ├── chassis_builder.rs        // generate position codes from axles
│   │   ├── dot_parser.rs             // parse "WWYY" → (week, year, date)
│   │   └── sync_engine.rs            // push/pull logic
│   └── utils/
│       ├── mod.rs
│       └── time.rs                   // Cairo TZ helpers
├── tests/
│   ├── integration/
│   └── fixtures/
└── README.md
```

### 10.1 Routing

```rust
// main.rs
HttpServer::new(|| {
    App::new()
        .wrap(Logger::default())
        .wrap(Cors::permissive())
        .service(web::scope("/api/maint")
            .service(handlers::health::routes())
            .service(
                web::scope("")
                    .wrap(auth::Middleware)
                    .service(handlers::cache_vehicles::routes())
                    .service(handlers::cache_invoices::routes())
                    .service(handlers::templates::routes())
                    .service(handlers::records::routes())
                    .service(handlers::due::routes())
                    .service(handlers::overrides::routes())
                    .service(handlers::chassis::routes())
                    .service(handlers::tires::routes())
                    .service(handlers::assignments::routes())
                    .service(handlers::sync::routes())
            )
        )
})
.bind(("127.0.0.1", config.port))?
.run()
.await
```

### 10.2 .env.example

```
DATABASE_URL=postgres://maint:secret@127.0.0.1:5432/apex_maint
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=<must match Falcon's JWT_SECRET>
FALCON_BASE_URL=https://apextransport.ddns.net/api/go
PORT=8090
RUST_LOG=info,maint_rust=debug
```

---

## 11. apex-maintenance project structure

Feature-Sliced Design (FSD), matching `apex-react`:

```
apex-maintenance/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── components.json                   // shadcn/ui config
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       ├── db.rs                     // SQLite pool + migrations
│       ├── keyring.rs                // JWT storage
│       ├── commands/                 // Tauri command handlers
│       │   ├── mod.rs
│       │   ├── auth.rs               // login, logout, get_token
│       │   ├── db_query.rs           // arbitrary SQL queries from JS
│       │   ├── db_mutate.rs          // mutations + outbox enqueue
│       │   └── sync.rs               // push, pull, refresh_cache
│       ├── sync/
│       │   ├── mod.rs
│       │   ├── push.rs
│       │   ├── pull.rs
│       │   └── cache_refresh.rs
│       └── http_client.rs            // ky equivalent for Rust side
├── src/
│   ├── app/
│   │   ├── App.tsx                   // root with providers
│   │   ├── routes.tsx                // TanStack Router tree
│   │   ├── providers.tsx             // QueryClient, i18n, theme
│   │   └── layouts/
│   │       ├── AppLayout.tsx         // sidebar + main + header
│   │       └── AuthLayout.tsx
│   ├── pages/                        // FSD: route-level
│   │   ├── login/
│   │   ├── dashboard/                // due-soon overview, expirations
│   │   ├── vehicles/
│   │   │   ├── list/
│   │   │   └── detail/               // car data, license cards, tabs
│   │   ├── chassis-editor/           // create/edit layout for a vehicle
│   │   ├── maintenance/
│   │   │   ├── templates/
│   │   │   ├── records/
│   │   │   └── due/
│   │   ├── tires/
│   │   │   ├── list/
│   │   │   ├── stock/                // new + used filters
│   │   │   ├── detail/
│   │   │   └── bulk-operations/
│   │   ├── service-invoices/
│   │   │   ├── search/
│   │   │   └── list/
│   │   └── settings/
│   ├── widgets/                      // FSD: composite UI blocks
│   │   ├── ChassisDiagram/           // top-down render of layout
│   │   ├── TireDetailDrawer/
│   │   ├── DueItemsTable/
│   │   ├── ExpirationCalendar/
│   │   ├── OdometerCard/
│   │   ├── SyncStatusBadge/          // header indicator: online/offline/syncing
│   │   └── OutboxQueueViewer/        // settings page
│   ├── features/                     // FSD: discrete user actions
│   │   ├── auth-login/
│   │   ├── auth-logout/
│   │   ├── chassis-build-layout/
│   │   ├── tire-mount-dialog/
│   │   ├── tire-dismount-dialog/
│   │   ├── tire-bulk-replace/
│   │   ├── template-create/
│   │   ├── record-mark-done/
│   │   ├── odometer-override/
│   │   └── language-toggle/
│   ├── entities/                     // FSD: data + business logic per type
│   │   ├── vehicle/
│   │   │   ├── api.ts                // queries against local DB
│   │   │   ├── model.ts              // TS types
│   │   │   └── lib.ts                // pure helpers
│   │   ├── driver/
│   │   ├── service-invoice/
│   │   ├── maintenance-template/
│   │   ├── maintenance-record/
│   │   ├── chassis/
│   │   ├── tire/
│   │   ├── tire-assignment/
│   │   └── odometer-override/
│   └── shared/                       // FSD: cross-cutting
│       ├── api/
│       │   ├── tauri.ts              // invoke wrappers
│       │   ├── http.ts               // ky instance for online-only paths
│       │   └── queryKeys.ts          // TanStack Query key factory
│       ├── db/
│       │   ├── queries.ts            // typed SQLite query helpers
│       │   └── migrations.ts
│       ├── i18n/
│       │   ├── index.ts              // i18next init
│       │   ├── ar.json               // Egyptian dialect
│       │   └── en.json
│       ├── ui/                       // shadcn/ui generated components
│       ├── lib/
│       │   ├── cn.ts
│       │   ├── time.ts               // dayjs Cairo TZ helpers
│       │   ├── numbers.ts            // Arabic numeral formatting
│       │   └── plate.ts              // Egyptian plate normalization
│       ├── hooks/
│       │   ├── useNetworkStatus.ts
│       │   ├── useSyncStatus.ts
│       │   └── useDirection.ts       // returns 'rtl' | 'ltr'
│       └── config/
│           └── env.ts
├── public/
└── README.md
```

### 11.1 Tauri ↔ JS API surface

```rust
// All commands invoked from JS via @tauri-apps/api/core's invoke().
#[tauri::command] async fn auth_login(email: String, password: String) -> Result<UserInfo>;
#[tauri::command] async fn auth_logout() -> Result<()>;
#[tauri::command] async fn auth_current_user() -> Result<Option<UserInfo>>;

#[tauri::command] async fn db_query(sql: String, params: Vec<Value>) -> Result<Vec<Row>>;
#[tauri::command] async fn db_execute(entity_type: String, entity_id: String,
                                       operation: String, payload: Value) -> Result<()>;

#[tauri::command] async fn sync_push() -> Result<SyncResult>;
#[tauri::command] async fn sync_pull() -> Result<SyncResult>;
#[tauri::command] async fn cache_refresh(name: String) -> Result<()>;
#[tauri::command] async fn cache_status() -> Result<Vec<CacheFreshness>>;

#[tauri::command] async fn outbox_pending() -> Result<i64>;
#[tauri::command] async fn outbox_clear_failed() -> Result<i64>;

#[tauri::command] async fn online_status() -> Result<bool>;
```

The JS layer never sees raw SQL strings except via shared/db/queries.ts wrappers. Mutations always go through `db_execute` which atomically (1) writes the row and (2) appends to `sync_outbox`.

---

## 12. i18n & RTL & Cairo timezone

### 12.1 i18next setup

```typescript
// shared/i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './ar.json';
import en from './en.json';

i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: 'ar',           // Arabic default
  fallbackLng: 'ar',
  interpolation: { escapeValue: false },
});

export default i18n;
```

### 12.2 RTL via dir attribute

```typescript
// app/App.tsx
useEffect(() => {
  const dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', i18n.language);
}, [i18n.language]);
```

Tailwind handles RTL via logical properties (`ms-`, `me-`, `start-`, `end-`) — never use `ml-`, `mr-`, `left-`, `right-` in this project. The Tailwind v3 RTL plugin or v4 native logical properties.

### 12.3 Egyptian dialect specifics

Translations should sound Egyptian, not MSA. Examples:

| Concept | MSA (avoid) | Egyptian (use) |
|---|---|---|
| "How are you" | كيف حالك | إزّيك |
| Vehicle | مَركَبة | عربية |
| Now | الآن | دلوقتي |
| Want | أريد | عايز / عاوز |
| Not | لا / ليس | مش |
| Money | نقود | فلوس |
| Fast / Speed | سرعة (same) | سرعة |
| Mark as done | وضع كمنجز | اعتبرها متعملة |
| Save | احفظ | حفظ (same in this context) |

Numbers display in Arabic-Indic numerals (`٠١٢٣٤٥٦٧٨٩`) when locale is `ar`. Use `Intl.NumberFormat('ar-EG', { numberingSystem: 'arab' })` or dayjs locale.

Plate numbers stay in their original form — never transliterate or romanize Egyptian Arabic plates.

### 12.4 Date/time

All timestamps stored as UTC in the DB; rendered in Africa/Cairo timezone. dayjs with `dayjs/plugin/timezone`:

```typescript
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import 'dayjs/locale/ar';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Africa/Cairo');

// Always format like:
const display = dayjs.utc(isoString).tz('Africa/Cairo').locale('ar').format('YYYY/MM/DD HH:mm');
```

Date inputs use HTML `<input type="date">` with `lang="ar-EG"` — browsers handle the locale-aware picker.

---

## 13. UX principles for non-technical users

These are **architectural constraints**, not nice-to-haves:

1. **One primary action per screen.** The big button is obvious. Secondary actions are visually subordinate.
2. **Plain Egyptian Arabic in error messages.** "حصلت مشكلة" not "خطأ في معالجة الطلب." Avoid technical terms.
3. **No undo trash. Soft delete with explicit restore.** If a user deletes something, they can find it under "محذوفات" and restore. No "are you sure" modals piled on modals.
4. **Sync status is always visible.** Header shows: 🟢 متصل / 🟠 يزامن (٣) / 🔴 غير متصل (يحفظ محلياً). No silent failures.
5. **Big tap targets.** Minimum 44 × 44 px. List rows are full-row clickable, not tiny chevron-triangles.
6. **Forms validate inline, on blur.** Not on submit. The user knows immediately if a field is wrong.
7. **Empty states explain what to do.** "لسه ما فيش جدول صيانة لهذه السيارة. ابدأ بإضافة قاعدة جديدة." with a button.
8. **Numbers are always grouped.** `145,000 كم` — never `145000 كم`.
9. **Loading states are non-jarring.** Skeleton placeholders with the same structure as the loaded view, not spinners that flip layouts.
10. **No pop-up notifications that auto-dismiss.** Toasts stay until clicked. A maintenance reminder is too important to flicker by.
11. **Print everything.** Tire history, maintenance log, vehicle expirations — all need a "طباعة" button that produces a clean A4-printable view (CSS `@media print`).
12. **All destructive actions are explicit.** "خردة" requires typing "خردة" to confirm, not just clicking. Same for permanent deletes.

---

## 14. Build & deployment

### 14.1 Local dev

```bash
# maint-rust
cd maint-rust
cp .env.example .env
sqlx database create
sqlx migrate run
cargo run

# apex-maintenance
cd apex-maintenance
pnpm install
pnpm tauri dev
```

### 14.2 Production builds

**maint-rust:**
- GitHub Actions workflow builds release binary, scp's to VPS, restarts systemd unit.
- Same pattern as existing apex-rust deploy.

**apex-maintenance:**
- GitHub Actions matrix builds: `windows-latest`, `macos-latest`, `ubuntu-latest`.
- Tauri's built-in updater plugin checks an Anthropic-hosted JSON endpoint or a static file on the VPS for new versions.
- Code signing required for macOS (Developer ID) and Windows (a code-signing cert) — without these, installs trigger Gatekeeper / SmartScreen warnings that will scare non-technical users.
- Linux: AppImage primary, DEB optional.

### 14.3 Hosting

- VPS: existing Hostinger Debian instance Shawket already operates.
- Postgres database `apex_maint` on the existing Postgres instance.
- Nginx site config:

```nginx
location /api/maint/ {
    proxy_pass http://127.0.0.1:8090/api/maint/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 90s;
}
```

- TLS via existing Let's Encrypt cert.

---

## 15. Implementation order

Suggested milestone breakdown for the implementer agent. Each milestone is a standalone PR that compiles, runs, and demonstrably works.

### M1 — Skeleton (week 1)

- maint-rust: project skeleton, `/health`, JWT middleware, DB connection.
- apex-maintenance: Tauri 2 scaffold, login screen, JWT in keyring, "hello world" dashboard.
- Falcon-side: tweak `/api/login` to include `jwt` in response body if not already (per evidence, it does).
- Nginx config + systemd unit + initial deploy.
- **Acceptance:** user can log in via desktop, app remembers session across restarts, hits `/api/maint/health` successfully.

### M2 — Cache layer (week 1-2)

- maint-rust: `/cache/vehicles`, `/cache/service-invoices`, `/cache/service-invoices/search` proxies + Redis caching.
- apex-maintenance: SQLite schema, vehicles/drivers/invoices cache tables, refresh logic in Rust side, vehicles list page rendering from local DB.
- Offline switching: airplane-mode toggle still shows full vehicle list.
- **Acceptance:** vehicles page works online and offline. Search works online (server) and offline (FTS5).

### M3 — Maintenance scheduling (week 2)

- maint-rust: templates + records CRUD, `v_maintenance_due` view, override endpoint.
- apex-maintenance: dashboard with due-soon table, vehicle detail tab for templates + history, Mark Done modal, manual odometer override card.
- Sync push/pull for these entities.
- **Acceptance:** create template, mark done, see status flip; works while offline with sync on reconnect.

### M4 — Vehicle data display (week 3)

- apex-maintenance: vehicle detail page with all car data fields, license cards with expiration countdown, driver info, license document image gallery.
- Dashboard: expiration calendar widget showing all licenses expiring in next 90 days.
- **Acceptance:** non-technical user can see at a glance which trucks have expiring paperwork.

### M5 — Chassis & tire engine, single ops (week 3-4)

- maint-rust: chassis layouts/axles/positions CRUD, tires CRUD, single mount/dismount endpoints.
- apex-maintenance: chassis editor (drag-drop axle builder), tire diagram widget, tire detail drawer with full history, mount/dismount dialogs.
- Sync support for all tire entities.
- **Acceptance:** build a layout for one truck, mount tires on every position, see them on the diagram, dismount and observe history.

### M6 — Tire bulk operations (week 4)

- maint-rust: `/tires/bulk` endpoint with transactional execution.
- apex-maintenance: bulk replace flow ("Replace all 4 drive tires"), bulk scrap flow, bulk move-to-stock.
- **Acceptance:** rotate 4 drive tires in one transaction; if any one fails, none apply.

### M7 — Service invoice search & integration (week 5)

- apex-maintenance: service invoices list, search page (online ranked + offline FTS).
- Vehicle detail page: timeline view combining maintenance records + service invoices for one truck.
- **Acceptance:** searching "فرامل" returns the correct invoices online; offline returns matches from FTS with banner.

### M8 — Polish, print, accessibility (week 5-6)

- Print stylesheets for tire history, maintenance log, vehicle expirations report.
- Egyptian-dialect translation review.
- Tauri auto-updater wired up.
- macOS & Windows code signing.
- **Acceptance:** Shawket installs on a clean Mac and a clean Windows machine, hands to a mechanic, mechanic completes a maintenance record without asking how anything works.

---

## 16. Open questions / future work

These were deliberately scoped out of v1 but flagged for later:

1. **Tire inspections and tread tracking.** Schema slot reserved (mention in §9 lead-in). When you want this, add `tire_inspections` table per the prior design conversation; nothing else changes.
2. **Photo attachments on tire mount/dismount.** Same — out for v1, easy add later via the existing `attachments JSONB` pattern on `maintenance_records`.
3. **Multi-user & role-based access.** Audit columns and JWT permission claim are already plumbed. When this becomes a need, add role checks at handler entry; no schema changes.
4. **Slack / WhatsApp notifications.** Out of scope; the dashboard banner is the only alerting mechanism.
5. **Multiple stock locations per tire.** `stock_location` is a free-text field. Promote to a lookup table when there's >1 yard.
6. **Native iOS / Android version.** The Tauri shell could in theory be replaced; the Rust core and SQLite schema are platform-agnostic. Not on the roadmap.
7. **Data export / CSV / accounting integration.** Print is in, programmatic export is out. Easy to add per-table.
8. **Offline JWT renewal.** Currently expired JWT means re-login. A background-refresh token would let the app stay alive longer offline, but Falcon doesn't expose one and that's acceptable.

---

## 17. Glossary

| Term | Meaning |
|---|---|
| **Falcon** | The existing Go fleet management backend at apextransport.ddns.net. Source of truth for vehicles, drivers, service invoices. |
| **maint-rust** | The new Rust microservice owning maintenance/tire/chassis data. |
| **apex-maintenance** | The new Tauri desktop application. |
| **apex-react** | Shawket's existing browser-based React fleet dashboard. Reference for stack and conventions, not modified by this project. |
| **Owned data** | Tables whose source of truth lives in `maint-rust`'s Postgres. Templates, records, layouts, tires, assignments, overrides. |
| **Cache data** | Tables mirroring upstream-owned data from Falcon. Vehicles, drivers, invoices. |
| **Outbox** | Local SQLite table holding pending mutations that need to sync upstream. |
| **Cursor** | A timestamp marking the last successful pull for a given entity type. |
| **Position code** | Stable identifier for an axle position, e.g. `H2RO` = head/tractor axle 2 right outer. |
| **DOT date code** | The 4-character `WWYY` block at the end of a tire's DOT serial. `4523` = week 45, year 2023. |
| **FSD** | Feature-Sliced Design — the frontend folder convention (pages/widgets/features/entities/shared). |

---

*End of architecture document.*
