//! apex-maintenance Rust core.
//!
//! Phase 1 surface:
//! - SQLite pool initialised on startup, every migration applied
//! - Tauri commands: ping, get_app_version, db_health
//! - Auth commands: auth_login, auth_logout, auth_current_user
//! - JWT persisted in the OS keychain via the `keyring` crate
//! - HTTP client wired with auto-Bearer-injection to maint-rust

pub mod commands;
pub mod db;
pub mod error;
pub mod http_client;
pub mod keyring_store;

use std::sync::Arc;

use tauri::Manager;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

pub use error::{AppError, AppResult};

/// Application-wide state held by Tauri's runtime.
pub struct AppState {
    pub db: Arc<db::DbPool>,
    pub http: Arc<http_client::HttpClient>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            // Resolve $APPDATA/apex_maintenance.db (or platform equivalent).
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("could not resolve app data dir: {e}"))?;

            std::fs::create_dir_all(&app_data_dir)
                .map_err(|e| format!("could not create app data dir: {e}"))?;

            let db_path = app_data_dir.join("apex_maintenance.db");
            tracing::info!(?db_path, "opening sqlite database");

            // Build the pool and run migrations synchronously at startup.
            let db = db::DbPool::open(&db_path)
                .map_err(|e| format!("failed to open sqlite pool: {e}"))?;
            db.run_migrations()
                .map_err(|e| format!("failed to run migrations: {e}"))?;

            // HTTP client is shared across the app; base URL configurable later.
            let http = http_client::HttpClient::new()
                .map_err(|e| format!("failed to build http client: {e}"))?;

            let state = AppState {
                db: Arc::new(db),
                http: Arc::new(http),
            };
            app.manage(state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health::ping,
            commands::health::get_app_version,
            commands::health::db_health,
            commands::auth::auth_login,
            commands::auth::auth_logout,
            commands::auth::auth_current_user,
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
