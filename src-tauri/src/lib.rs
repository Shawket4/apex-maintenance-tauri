//! apex-maintenance Rust core.
//!
//! Phase 1:
//!  - SQLite pool initialised on startup, every migration applied
//!  - Tauri commands: ping, get_app_version, db_health
//!  - Auth commands: auth_login, auth_logout, auth_current_user
//!  - JWT persisted in the OS keychain via the `keyring` crate
//!  - HTTP client wired with auto-Bearer-injection to maint-rust
//!
//! Phase 2:
//!  - All tunables come from `AppConfig` (env-driven, no hardcoded values)
//!  - Vehicle / driver / invoice cache mirroring with read-through pattern
//!  - cache_freshness rows updated on every successful refresh
//!  - Online: calls maint-rust's /cache/* proxies; offline: serves SQLite
//!  - FTS5-backed offline invoice search
//!  - Lenient JSON deserializers for Falcon's mixed type encoding

pub mod commands;
pub mod config;
pub mod db;
pub mod error;
pub mod http_client;
pub mod keyring_store;
pub mod models;
pub mod services;
pub mod util;

use std::sync::Arc;

use tauri::Manager;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

pub use config::AppConfig;
pub use error::{AppError, AppResult};

/// Application-wide state held by Tauri's runtime.
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub db: Arc<db::DbPool>,
    pub http: Arc<http_client::HttpClient>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    // Config first — every subsequent component reads from it.
    let config = Arc::new(AppConfig::load());

    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .setup({
            let config = config.clone();
            move |app| {
                // SQLite path: <app-data-dir>/<configured-filename>
                let app_data_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("could not resolve app data dir: {e}"))?;
                std::fs::create_dir_all(&app_data_dir)
                    .map_err(|e| format!("could not create app data dir: {e}"))?;

                let db_path = config.db_path(&app_data_dir);
                tracing::info!(?db_path, "opening sqlite database");

                let db = db::DbPool::open(&db_path)
                    .map_err(|e| format!("failed to open sqlite pool: {e}"))?;
                db.run_migrations()
                    .map_err(|e| format!("failed to run migrations: {e}"))?;

                let http = http_client::HttpClient::new(config.clone())
                    .map_err(|e| format!("failed to build http client: {e}"))?;

                let state = AppState {
                    config: config.clone(),
                    db: Arc::new(db),
                    http: Arc::new(http),
                };
                app.manage(state);

                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Phase 1
            commands::health::ping,
            commands::health::get_app_version,
            commands::health::db_health,
            commands::auth::auth_login,
            commands::auth::auth_logout,
            commands::auth::auth_current_user,
            // Phase 2
            commands::cache::vehicles_list,
            commands::cache::vehicles_refresh,
            commands::cache::drivers_list,
            commands::cache::invoices_list,
            commands::cache::invoices_refresh,
            commands::cache::invoices_search,
            commands::cache::cache_freshness_get,
        ])
        .run(tauri::generate_context!())
        .expect("error while running apex-maintenance");
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,apex_maintenance_lib=debug"));

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().with_target(true).compact())
        .init();
}