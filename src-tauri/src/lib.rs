//! apex-maintenance Rust core.

pub mod commands;
pub mod config;
pub mod db;
pub mod error;
pub mod http_client;
pub mod models;
pub mod services;
pub mod session_store;
pub mod util;

use std::path::PathBuf;
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
    /// Tauri's app-data directory. Used by `session_store` to read/write
    /// `session.jwt` and `session.user.json` on disk.
    pub data_dir: PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    let config = Arc::new(AppConfig::load());

    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup({
            let config = config.clone();
            move |app| {
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

                let http = http_client::HttpClient::new(config.clone(), app_data_dir.clone())
                    .map_err(|e| format!("failed to build http client: {e}"))?;

                let state = AppState {
                    config: config.clone(),
                    db: Arc::new(db),
                    http: Arc::new(http),
                    data_dir: app_data_dir,
                };
                app.manage(state);

                // Phase 3: Background sync
                start_sync_loops(app.handle().clone());

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
            commands::cache::invoice_get,
            commands::cache::cache_freshness_get,
            commands::window::print_pdf,
            commands::export::export_to_excel,
            // Phase 3
            commands::sync::sync_get_status,
            commands::sync::sync_push,
            commands::sync::sync_pull,
            commands::sync::sync_now,
            commands::sync::sync_list_conflicts,
            commands::sync::sync_resolve_conflict,
            commands::sync::test_create_odometer_override,
            commands::sync::test_reset_sync_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running apex-maintenance");
}

fn start_sync_loops(app_handle: tauri::AppHandle) {
    use crate::services::sync::SyncService;
    use tauri::Manager;

    let state = app_handle.state::<AppState>();
    let sync_service = Arc::new(SyncService::new(state.db.clone(), state.http.clone()));
    let config = state.config.clone();

    // Push loop
    tauri::async_runtime::spawn({
        let sync_service = sync_service.clone();
        let interval = config.sync.push_interval;
        async move {
            tracing::info!(?interval, "starting background push loop");
            loop {
                tokio::time::sleep(interval).await;
                // Only push if we have a valid JWT
                if let Err(e) = sync_service.push_all().await {
                    if !matches!(e, crate::AppError::Unauthorized) {
                        tracing::error!(?e, "background push failed");
                    }
                }
            }
        }
    });

    // Pull loop
    tauri::async_runtime::spawn({
        let sync_service = sync_service.clone();
        let interval = config.sync.pull_interval;
        async move {
            tracing::info!(?interval, "starting background pull loop");
            loop {
                tokio::time::sleep(interval).await;
                if let Err(e) = sync_service.pull_all().await {
                    if !matches!(e, crate::AppError::Unauthorized) {
                        tracing::error!(?e, "background pull failed");
                    }
                }
            }
        }
    });
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,apex_maintenance_lib=debug"));

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().with_target(true).compact())
        .init();
}
