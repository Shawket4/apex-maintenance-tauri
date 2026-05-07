//! Liveness commands. These are the first thing the JS side calls when it
//! mounts — they verify that the Rust core, the SQLite pool, and migrations
//! are all healthy before showing any UI that depends on them.

use serde::Serialize;
use tauri::State;

use crate::{db::DbHealth, AppResult, AppState};

#[derive(Serialize)]
pub struct AppVersion {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
}

#[tauri::command]
pub async fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
pub async fn get_app_version() -> AppVersion {
    AppVersion {
        name: env!("CARGO_PKG_NAME").to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        tauri_version: tauri::VERSION.to_string(),
    }
}

#[tauri::command]
pub async fn db_health(state: State<'_, AppState>) -> AppResult<DbHealth> {
    // r2d2 returns a synchronous connection — fine on Tauri's command runtime
    // because the task is short.
    state.db.health()
}
