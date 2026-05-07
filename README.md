# apex-maintenance

Tauri 2 desktop client for the Apex Transport maintenance, chassis & tire
management system. Talks to `maint-rust` on
`https://apextransport.ddns.net/api/maint/*` (and to Falcon on `/api/go/*` for
login only). Offline-first; all reads served from a local SQLite mirror, all
writes routed through a sync outbox.

This README covers Phase 1 only. Each subsequent phase will append its own
section.

---

## Phase 1 — what's included

- Tauri 2 shell, configured for Windows / macOS / Linux bundles
- Rust core:
  - SQLite pool (rusqlite + r2d2, WAL + foreign keys + 5s busy timeout)
  - Versioned migration runner — full §6 schema (cache mirrors, owned data,
    sync_outbox / sync_cursors / cache_freshness, FTS5 over service items,
    views `v_maintenance_due` / `v_tire_lifetime` / `v_tires_list`)
  - Bilingual maintenance categories seeded
  - HTTP client (reqwest) with auto-`Authorization: Bearer` injection from
    the OS keychain and `401 → AppError::Unauthorized` re-login signal
  - JWT persistence via the `keyring` crate (Keychain / Credential Manager /
    Secret Service)
  - Tauri commands: `ping`, `get_app_version`, `db_health`,
    `auth_login`, `auth_logout`, `auth_current_user`
- Frontend:
  - Vite + React 19 + TypeScript strict
  - Tailwind 3 with `tailwindcss-rtl`, status-color tokens
  - shadcn/ui primitives (Button, Input, Label, Card)
  - TanStack Query, TanStack Router (memory-history, code-based), Zustand,
    react-i18next, dayjs (Africa/Cairo)
  - Login screen → `auth_login` → JWT in keychain → `/`
  - Dashboard placeholder that calls every Phase 1 command for verification
  - Arabic-default Egyptian-dialect copy with EN fallback, `dir="rtl"` on
    `<html>` and a one-click language toggle in the header

## Stack deviations from the architecture doc

Two minor calls — flag if either is a problem:

1. **rusqlite (not better-sqlite3).** §11 lists better-sqlite3 "via Tauri Rust
   side". better-sqlite3 is a Node binding; from Rust the equivalent
   synchronous primitive is rusqlite (with `bundled` feature so no system
   libsqlite is required).
2. **TanStack Router code-based.** §11 says "file-based". For Phase 1's two
   routes, code-based with `pages/` already laid out FSD-style is cleaner.
   Switching to file-based with `@tanstack/router-plugin/vite` is mechanical
   once the route surface grows.

---

## Prerequisites

- **Node.js ≥ 20 LTS** (`node -v`)
- **Rust ≥ 1.75** (`rustup show`)
- Platform deps for Tauri 2 — follow
  https://v2.tauri.app/start/prerequisites/. The big ones:
  - **macOS:** Xcode CLT (`xcode-select --install`)
  - **Windows:** Microsoft C++ Build Tools + WebView2 (preinstalled on
    Win10 21H2+ / Win11)
  - **Linux:** `webkit2gtk-4.1`, `libsoup-3.0`, `librsvg2`, build essentials,
    plus `libdbus-1-dev` and `libssl-dev` for the keyring backend

---

## Run in dev

```bash
npm install
npm run tauri:dev
```

First run takes a few minutes (Cargo compiles the Rust core and all crates).
Subsequent runs are incremental.

The frontend dev server runs on `http://localhost:1420`; Tauri swallows it
inside the desktop window. HMR works for the React side; Rust changes trigger
an automatic rebuild + window reload.

### Pointing at a non-prod backend

The HTTP client reads `APEX_BASE_URL` to override
`https://apextransport.ddns.net`:

```bash
APEX_BASE_URL=http://127.0.0.1:8090 npm run tauri:dev
```

(Note: in dev, `RUST_LOG=debug` already gives you per-request tracing.)

---

## Verify Phase 1

After `npm run tauri:dev` opens the window:

### 1. Login screen renders correctly

- Window title is **"Apex Maintenance"**.
- The `<html>` element has `dir="rtl"` and `lang="ar"`. (DevTools → Elements
  → top-of-tree.)
- Card shows "صيانة أبكس" / "ادخل بياناتك عشان تكمّل" / two text fields /
  one big primary button labelled **"دخول"**.
- Click the small `English` link below the button. The whole UI flips to
  LTR and English copy. `<html dir>` updates to `ltr` and `lang` to `en`.
  Switch back.

### 2. Login works against the real Falcon

- Enter your Apex Transport credentials.
- Submit. Spinner appears, then the window navigates to the dashboard.
- Verify the JWT was persisted to the OS keychain:
  - **macOS:** `security find-generic-password -s apex_maintenance.jwt`
  - **Windows:** `cmdkey /list:apex_maintenance.jwt`
  - **Linux:** `secret-tool lookup service apex_maintenance.jwt account default`
- Restart the app (`Cmd-Q` / close window, then `npm run tauri:dev` again).
  You should land directly on the dashboard, not the login screen — proving
  `auth_current_user` reads back the persisted user blob.

### 3. The Phase 1 dashboard tells you everything is wired

The dashboard renders four stat tiles plus a green "Phase 1 — جاهز" banner:

| Tile                  | Expected value                                                     |
| --------------------- | ------------------------------------------------------------------ |
| ترحيلات منفّذة        | **2** (the schema migration + the seeds migration)                 |
| تصنيفات الصيانة       | **10** (one per category in §5.2)                                  |
| عمليات في الانتظار     | **0** (sync_outbox is empty)                                       |
| Tauri ping            | **pong**                                                           |

The "App version" card below shows `name=apex-maintenance`, `version=0.1.0`,
and the running Tauri version.

If any tile shows `…` for more than a couple of seconds, open DevTools
(`Cmd-Option-I` / `Ctrl-Shift-I`) → Console — Tauri command failures surface
as `{ kind, message }` errors there.

### 4. The local SQLite database exists with the full schema

The DB lives at the platform's app-data directory:

| OS      | Path                                                                       |
| ------- | -------------------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/com.apextransport.maintenance/apex_maintenance.db` |
| Windows | `%APPDATA%\com.apextransport.maintenance\apex_maintenance.db`              |
| Linux   | `~/.local/share/com.apextransport.maintenance/apex_maintenance.db`         |

Open it and confirm:

```sh
sqlite3 "$APP_DATA_DIR/apex_maintenance.db"
sqlite> .tables
```

Expected tables: `_migrations`, `cache_freshness`, `chassis_axles`,
`chassis_layouts`, `chassis_positions`, `drivers_cache`,
`maintenance_categories`, `maintenance_records`, `maintenance_templates`,
`service_invoice_items_cache`, `service_invoice_items_fts`, `service_invoices_cache`,
`sync_cursors`, `sync_outbox`, `tire_assignments`, `tires`, `vehicle_odometer_overrides`,
`vehicles_cache`. Plus FTS shadow tables (`_data`, `_idx`, `_docsize`, `_config`).

```sql
sqlite> SELECT version, name FROM _migrations;
1|0001_init_schema
2|0002_seeds

sqlite> SELECT id, name_ar FROM maintenance_categories ORDER BY sort_order;
oil_change|تغيير زيت
air_filter|فلتر هواء
fuel_filter|فلتر سولار
oil_filter|فلتر زيت
brakes|فرامل
coolant|مياه تبريد
transmission|زيت فتيس
battery|بطارية
inspection|فحص دوري
greasing|تشحيم

sqlite> .schema v_maintenance_due
sqlite> .schema v_tires_list
```

Both views should print without error — that's the SQLite-flavoured
re-implementation of the Postgres views.

```sql
sqlite> SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='service_invoice_items_cache';
siic_ai
siic_au
siic_ad
```

The three FTS sync triggers from §4.3 are present.

### 5. Logout

Click the logout icon in the header. You should land back on `/login`. Then
confirm the keychain entry is gone (re-run the platform-specific command from
step 2 — it should now report no entry).

---

## Project layout

```
apex-maintenance/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── components.json
├── index.html
├── src-tauri/                 # Rust core
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   ├── icons/
│   └── src/
│       ├── main.rs
│       ├── lib.rs             # setup, command registration
│       ├── error.rs           # serializable AppError { kind, message }
│       ├── db.rs              # r2d2 SQLite pool + migrations runner
│       ├── keyring_store.rs   # OS keychain JWT + user JSON
│       ├── http_client.rs     # reqwest wrapper, auto-Bearer
│       ├── commands/
│       │   ├── mod.rs
│       │   ├── auth.rs        # auth_login / auth_logout / auth_current_user
│       │   └── health.rs      # ping / get_app_version / db_health
│       └── migrations/
│           ├── 0001_init_schema.sql
│           └── 0002_seeds.sql
└── src/                       # FSD frontend
    ├── main.tsx
    ├── index.css
    ├── app/
    │   ├── App.tsx
    │   ├── providers.tsx
    │   ├── routes.tsx
    │   └── layouts/
    │       ├── AppLayout.tsx
    │       └── AuthLayout.tsx
    ├── pages/
    │   ├── login/LoginPage.tsx
    │   └── dashboard/DashboardPage.tsx
    └── shared/
        ├── api/
        │   ├── tauri.ts
        │   └── auth.ts
        ├── hooks/
        │   └── useNetworkStatus.ts
        ├── i18n/
        │   ├── index.ts
        │   ├── ar.json        # Egyptian dialect
        │   └── en.json
        ├── lib/
        │   ├── cn.ts
        │   ├── time.ts        # Cairo TZ helpers
        │   └── numbers.ts     # Arabic-Indic formatters
        └── ui/                # shadcn/ui
            ├── button.tsx
            ├── card.tsx
            ├── input.tsx
            └── label.tsx
```

---

## Production build

```bash
npm run tauri:build
```

Bundles end up in `src-tauri/target/release/bundle/{dmg,msi,deb,appimage}/`.
Code signing for macOS / Windows is wired up in Phase 6.

---

## Troubleshooting

- **`failed to run custom build command for 'libsecret-sys'` on Linux** —
  install the system dev packages: `sudo apt install libsecret-1-dev pkg-config`.
- **Login returns "في مشكلة في الاتصال" / "Connection problem"** — the Rust
  layer either couldn't reach the server (check `APEX_BASE_URL` and your
  network) or the server returned a non-2xx that wasn't a 401. `RUST_LOG=debug`
  surfaces the actual URL + status code.
- **Login returns "البريد أو كلمة السر غلط"** — Falcon rejected the
  credentials (or returned `success: false`).
- **Dashboard tile stuck on `…`** — DevTools console will show the rejected
  Tauri promise with `{ kind, message }`. The most common Phase 1 cause is
  the keychain backend not being available on a headless Linux box; install
  `gnome-keyring` or run with a real desktop session.
- **Need to wipe local state** — close the app, delete the
  `apex_maintenance.db` file under your platform's app-data dir, and clear
  the `apex_maintenance.jwt` and `apex_maintenance.user` keychain entries.

---

## Next: Phase 2

Phase 2 layers read-through caching of `/cache/vehicles` and
`/cache/service-invoices` on top of this foundation, plus the FTS5-backed
offline search box. The schema is already in place; only the sync code and
two new pages are needed.
