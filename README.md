# apex-maintenance

Tauri 2 desktop client for the Apex Transport maintenance, chassis & tire
management system. Talks to `maint-rust` on
`https://apextransport.ddns.net/api/maint/*` (and to Falcon on `/api/go/*` for
login only). Offline-first; all reads served from a local SQLite mirror, all
writes routed through a sync outbox (Phase 3).

---

## Configuration

Every tunable value — backend URL, prefixes, timeouts, refresh intervals,
keychain entry names, page sizes, log level — lives in `.env`.

```bash
cp .env.example .env       # working copy, gitignored
# edit .env if you want to point at a non-prod backend
```

The same file is read by **two** consumers:

- **Rust core** (via `dotenvy` at startup). All `APEX_*` vars + `RUST_LOG`.
  Defaults baked into `src-tauri/src/config.rs` so a fresh clone runs even
  without a `.env`. OS env vars override `.env`.
- **Vite** (at build time). Only `VITE_*` prefixed vars are exposed to the
  frontend bundle. Read through `src/shared/config/env.ts` (the only place
  the codebase touches `import.meta.env`).

Restart the app (`Ctrl-C`, `npm run tauri:dev`) after editing `.env` —
neither Vite nor Cargo watches it.

> **CSP note.** `tauri.conf.json` carries a static `connect-src` allowing
> `apextransport.ddns.net`. CSP only constrains JS-initiated requests; all
> backend traffic in this app goes through reqwest in the Rust core (not
> JS `fetch`), so changing `APEX_BASE_URL` works without CSP changes. If
> you ever start calling backends directly from JS, update CSP too.

---

## Phase 1 — what's included

- Tauri 2 shell, configured for Windows / macOS / Linux bundles
- Rust core:
  - SQLite pool (rusqlite + r2d2, WAL set once on a setup connection so the
    pool init doesn't race; `synchronous=NORMAL`, `foreign_keys=ON`,
    `busy_timeout=5000`)
  - Versioned migration runner — full §6 schema (cache mirrors, owned data,
    sync_outbox / sync_cursors / cache_freshness, FTS5 over service items,
    views `v_maintenance_due` / `v_tire_lifetime` / `v_tires_list`)
  - Bilingual maintenance categories seeded
  - HTTP client (reqwest) with auto-`Authorization: Bearer` injection from
    the OS keychain and `401 → AppError::Unauthorized` re-login signal
  - JWT persistence via the `keyring` crate (Keychain / Credential Manager /
    Secret Service), service names from config
  - Tauri commands: `ping`, `get_app_version`, `db_health`,
    `auth_login`, `auth_logout`, `auth_current_user`
  - Auth: success-flag-driven (server `success: true` is authoritative; JWT
    may be empty initially); response logged on every call for diagnostics
- Frontend:
  - Vite + React 19 + TypeScript strict, Tailwind 3 with `tailwindcss-rtl`
  - Type-checks run on TypeScript 7's `tsc` (`@typescript/native` in package.json);
    the `typescript` package stays the 6.0 API (`@typescript/typescript6`, with `tsc6`)
    for type-aware ESLint, since 7.0 ships no API
  - shadcn/ui primitives (Button, Input, Label, Card)
  - TanStack Query, TanStack Router (memory-history), Zustand,
    react-i18next, dayjs (Africa/Cairo + relativeTime)
  - Login screen, dashboard placeholder showing every Phase 1 command
  - Egyptian-Arabic copy + EN fallback, header language toggle
  - `dir` + `lang` on `<html>` follow the active locale

## Phase 2 — what's new

- Read-through cache for vehicles + drivers + service-invoices + items
  - Page-walks `/api/maint/cache/service-invoices?page=N&limit=M` until the
    server reports done
  - Single-call refresh of `/api/maint/cache/vehicles` (vehicles + drivers)
  - All writes happen in one transaction per call; `service_invoice_items_cache`
    is replaced wholesale per invoice so the FTS5 triggers rebuild the index
    atomically
  - `cache_freshness` row updated after every successful refresh
- New Tauri commands:
  - `vehicles_list`, `vehicles_refresh`
  - `drivers_list`
  - `invoices_list({ page, limit })`, `invoices_refresh`
  - `invoices_search({ query, limit })` — online ranked search via
    maint-rust, falling back to local FTS5 if the server's unreachable
  - `cache_freshness_get`
- New pages:
  - **Vehicles** — virtualized table (@tanstack/react-virtual), client-side
    filter, expiration cells colour-coded ok/due_soon/overdue, freshness pill
    + manual refresh button
  - **Invoices** — virtualized table with pagination, debounced search box
    (debounce ms in env), online/offline source badge, freshness pill
- New widgets:
  - **AppSidebar** — left rail with active-state, Dashboard / Vehicles /
    Invoices entries
  - **CacheFreshnessIndicator** — green/amber/grey dot + "last refreshed
    Xm ago" in active locale + refresh button
- New shared utilities:
  - `useDebouncedValue<T>` hook for the search box
  - `freshness.ts` — TanStack Query wrapper around `cache_freshness_get`
- Background polling: vehicles auto-refresh every
  `VITE_VEHICLES_REFETCH_INTERVAL_MS`, invoices every
  `VITE_INVOICES_REFETCH_INTERVAL_MS`, only when online

## Stack notes

- **rusqlite (not better-sqlite3)** for sync access from Rust.
- **TanStack Router code-based** for now, file-based migration is mechanical.
- **Inline urlencoder** in `commands/cache.rs` for one call site rather than
  a dependency on the `urlencoding` crate.

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
    plus `libdbus-1-dev`, `libssl-dev`, and `libsecret-1-dev` for the
    keyring backend; also `gnome-keyring` running for the actual keychain

## Run in dev

```bash
cp .env.example .env
npm install
npm run tauri:dev
```

First run takes a few minutes (Cargo compiles the Rust core and all crates).
Subsequent runs are incremental.

To point at a non-prod backend, edit `APEX_BASE_URL` in `.env`. To increase
log verbosity, edit `RUST_LOG=trace,apex_maintenance_lib=trace`.

---

## Verify Phase 2

After `npm run tauri:dev` and login (Phase 1's verification still applies):

### 1. Sidebar + navigation

- Three nav items in the left rail: **الرئيسية**, **العربيات**,
  **فواتير الصيانة** (or English equivalents).
- Clicking each navigates without a full reload. The active item is
  highlighted in primary color.

### 2. Vehicles page

- On first visit you may see "مفيش عربيات في الكاش لسه — اضغط تحديث". Tap
  the **تحديث** button in the header.
- Watch the Rust logs (`RUST_LOG=info,apex_maintenance_lib=debug`) — you'll
  see:
  ```
  DEBUG http_client: maint GET url=…/api/maint/cache/vehicles
  DEBUG http_client: http response url=… status=200 body_len=…
  INFO  commands::cache: vehicles cache refreshed vehicles=N drivers=M
  ```
- The table populates immediately. Plate, type, transporter, driver,
  odometer, plus colour-coded license/calibration expiration cells:
  red=overdue, amber=due-soon (within 30 days), green=ok, grey=missing.
- Type a partial plate / driver name in the search box — rows filter
  client-side instantly.
- Header pill should now read "آخر تحديث منذ بضع ثوان" and a green dot.
  Wait `APEX_CACHE_VEHICLES_TTL_SECS` (default 300s) and the dot turns
  amber.

### 3. Invoices page

- Tap **تحديث** to walk the cache. The first refresh takes longer (page-walks
  the entire dataset); subsequent refreshes are fast (the upsert is keyed
  by invoice id).
- Pagination footer appears once total > page size (default 100). **السابق /
  التالي** scroll through the cache.
- Type "زيت" (or any term used in real invoices) in the search box. After
  ~400ms (`VITE_SEARCH_DEBOUNCE_MS`), results appear. Header shows a
  **بحث السيرفر** green pill — search hit `/api/maint/cache/service-invoices/search`.
- Pull your network cable / kill DNS / set `APEX_BASE_URL=http://0.0.0.0:1`
  in `.env` and restart. Search again — results now come from the local
  FTS5 index, badge turns into **بحث محلي** with the amber `CloudOff` icon.

### 4. Local DB confirms the upsert

```sh
sqlite3 "$APP_DATA_DIR/apex_maintenance.db"
sqlite> SELECT COUNT(*) FROM vehicles_cache;
sqlite> SELECT COUNT(*) FROM drivers_cache;
sqlite> SELECT COUNT(*) FROM service_invoices_cache;
sqlite> SELECT COUNT(*) FROM service_invoice_items_cache;

sqlite> SELECT * FROM cache_freshness;
vehicles|2026-05-08T12:34:56.789Z|300|0
service_invoices|2026-05-08T12:35:14.012Z|900|0

-- FTS5 sanity: substring of any service text in your real data
sqlite> SELECT it.id, it.service
   ...> FROM service_invoice_items_fts f
   ...> JOIN service_invoice_items_cache it ON it.id = f.rowid
   ...> WHERE service_invoice_items_fts MATCH '"زيت"*'
   ...> LIMIT 5;
```

### 5. Background polling

- Leave the vehicles page open. Watch the logs — every
  `APEX_CACHE_VEHICLES_REFRESH_INTERVAL_SECS` (default 60s) you'll see a
  `vehicles_refresh` round-trip. Navigate away → polling stops (the
  `useVehiclesAutoRefresh` hook is unmounted with the page).

---

## Project layout

```
apex-maintenance/
├── .env                         # gitignored — your working values
├── .env.example                 # committed — every var documented
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── components.json
├── index.html
├── src-tauri/                   # Rust core
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   ├── icons/
│   └── src/
│       ├── main.rs
│       ├── lib.rs               # setup, command registration
│       ├── config.rs            # AppConfig from env (single source)
│       ├── error.rs             # serializable AppError { kind, message }
│       ├── db.rs                # r2d2 SQLite pool + migrations runner
│       ├── keyring_store.rs     # OS keychain JWT + user JSON, config-driven
│       ├── http_client.rs       # reqwest wrapper, auto-Bearer, raw response
│       ├── commands/
│       │   ├── mod.rs
│       │   ├── auth.rs          # auth_login / auth_logout / auth_current_user
│       │   ├── cache.rs         # Phase 2: vehicles_*, invoices_*, freshness
│       │   └── health.rs        # ping / get_app_version / db_health
│       ├── models/
│       │   ├── cache_freshness.rs
│       │   ├── driver.rs
│       │   ├── invoice.rs       # CachedInvoice, InvoiceRow, search envelope
│       │   └── vehicle.rs       # CachedVehicle, VehicleRow
│       ├── services/
│       │   └── cache_sync.rs    # transactional upserts + FTS5 search
│       └── migrations/
│           ├── 0001_init_schema.sql
│           └── 0002_seeds.sql
└── src/                         # FSD frontend
    ├── main.tsx
    ├── index.css
    ├── app/
    │   ├── App.tsx
    │   ├── providers.tsx
    │   ├── routes.tsx
    │   └── layouts/
    │       ├── AppLayout.tsx    # header + sidebar + main
    │       └── AuthLayout.tsx
    ├── pages/
    │   ├── login/LoginPage.tsx
    │   ├── dashboard/DashboardPage.tsx
    │   ├── vehicles/list/VehiclesListPage.tsx
    │   └── invoices/list/InvoicesListPage.tsx
    ├── widgets/
    │   ├── AppSidebar/AppSidebar.tsx
    │   └── CacheFreshnessIndicator/CacheFreshnessIndicator.tsx
    ├── entities/
    │   ├── cache_freshness/model.ts
    │   ├── driver/model.ts
    │   ├── invoice/model.ts
    │   └── vehicle/model.ts
    └── shared/
        ├── config/
        │   └── env.ts           # typed wrapper around import.meta.env
        ├── api/
        │   ├── tauri.ts
        │   ├── auth.ts
        │   ├── vehicles.ts      # useVehiclesQuery, useVehiclesRefresh, …
        │   ├── invoices.ts      # useInvoicesQuery, useInvoicesSearchQuery, …
        │   └── freshness.ts     # useCacheFreshness
        ├── hooks/
        │   └── useNetworkStatus.ts
        ├── i18n/
        │   ├── index.ts         # reads default lang from env
        │   ├── ar.json          # Egyptian dialect
        │   └── en.json
        ├── lib/
        │   ├── cn.ts
        │   ├── time.ts          # Cairo TZ + relativeTime
        │   ├── numbers.ts       # Arabic-Indic formatters
        │   └── useDebouncedValue.ts
        └── ui/
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
For production, pre-set the OS env vars (`APEX_BASE_URL`, etc.) before
launching the binary; `.env` is for development only.

---

## Troubleshooting

- **Login fails with "البريد أو كلمة السر غلط" on correct credentials** —
  check Falcon's response in the logs:
  ```
  DEBUG commands::auth: falcon login response email=… status=200 body_len=…
  WARN  commands::auth: login rejected by server success=false body=…
  ```
  The `body=…` quote shows what Falcon returned. Auth is success-flag-driven
  now: if `success: false` (or missing/string-falsy), we surface AuthFailed.
- **`database is locked` at startup** — should be fixed; WAL is set once on
  a setup connection before the pool builds. If you still see it, blow away
  `apex_maintenance.db` once and restart.
- **Vehicles page shows nothing after refresh** — check the logs for
  `commands::cache: vehicles cache refreshed vehicles=N`. If N=0, maint-rust
  returned an empty array (check the JWT and the route).
- **Search hangs** — the search query fires after 400ms of stillness. If
  it's stuck on the spinner, the `/cache/service-invoices/search` endpoint
  is timing out. The offline fallback only kicks in on `AppError::Http`,
  not on timeouts hitting the 30s ceiling. Decrease
  `APEX_REQUEST_TIMEOUT_SECS` if you want a faster fallback.
- **`failed to run custom build command for 'libsecret-sys'` on Linux** —
  install the system dev packages: `sudo apt install libsecret-1-dev pkg-config`.
- **Tile / pill stuck on `…`** — DevTools console will show the rejected
  Tauri promise with `{ kind, message }`.
- **Wipe local state** — close the app, delete `apex_maintenance.db`, and
  clear the keychain entries (`APEX_KEYCHAIN_SERVICE_*`, default
  `apex_maintenance.jwt` and `apex_maintenance.user`).

---

## Next: Phase 3

Phase 3 wires the sync engine: outbox writer fed by every local mutation,
push loop that drains in batches of 50 against `POST /api/maint/sync/push`
with per-op applied/conflict/error handling, pull loop using
`sync_cursors`, conflict-resolution UX, plus the offline indicator and
manual-sync button. The schema (sync_outbox, sync_cursors, sync_version
columns on every owned table) is already in place from Phase 1.
