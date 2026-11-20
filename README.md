# Apex Maintenance

The garage app for Apex Transport: work orders, oil changes, tires on a wheel
map, preventive maintenance, stock. Tauri 2 (Rust core + React UI), for
Windows/macOS/Linux desktops and Android.

It works without a connection. Everything is read from a local SQLite
database, every change is written there first and sent to the server
([maint-rust](https://github.com/Shawket4/maint-rust)) when it can be. See
[ARCHITECTURE.md](ARCHITECTURE.md) for how that works and what the rules are.

## Run it

```bash
npm ci
npm run tauri:dev            # desktop, against the production server
```

Against a local server:

```bash
# in ../maint-rust:  MAINT_DEV_LOGIN=1 cargo run        (debug build: any email/password signs in)
APEX_BASE_URL=http://127.0.0.1:8095 npm run tauri:dev
```

Configuration is read from the environment (a `.env` in the working directory
is loaded in development). Defaults are in `src-tauri/src/config.rs`.

| Variable | Default | |
|---|---|---|
| `APEX_BASE_URL` | `https://apextransport.ddns.net` | Server origin. |
| `APEX_MAINT_PREFIX` | `/api/maint` | maint-rust. |
| `APEX_RUST_PREFIX` | `/api/rust` | apex-rust (AI history search). |
| `APEX_FALCON_PREFIX` | `/api/go` | Falcon (sign-out only). |
| `APEX_REQUEST_TIMEOUT_SECS` | `30` | |
| `APEX_SYNC_HEARTBEAT_SECS` | `30` | Queue is sent on this beat; a pull runs every two minutes. |
| `APEX_SYNC_PUSH_BATCH_SIZE`, `APEX_SYNC_PULL_LIMIT` | `50`, `200` | |
| `APEX_DB_FILENAME` | `apex_maintenance.db` | In the app data directory. |

## Checks

```bash
npm run typecheck && npm run lint && npm test     # UI
cd src-tauri && cargo test                        # Rust core; also regenerates src/shared/api/bindings.ts
./scripts/e2e_live.sh                             # two "devices" against a real maint-rust + Postgres
```

`src/shared/api/bindings.ts` is generated from the Rust commands by
`cargo test`. Never edit it; CI fails if it is stale.

CI (`.github/workflows/ci.yml`) runs all three on every pull request. The
end-to-end job uses the maint-rust branch with the same name as the pull
request's branch when there is one, so a change to both sides is tested
together.

## Release

Push a `vX.Y.Z` tag (after bumping the version in `package.json`,
`src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`). The Release workflow
builds the desktop installers and a signed Android APK and attaches them to a
GitHub release.

Deploy the server first when a release depends on new server behaviour. The
server keeps accepting older apps; set `MIN_CLIENT_VERSION` on the server to
make older apps ask for an update.
