//! Liveness commands. These are the first thing the JS side calls when it
//! mounts — they verify that the Rust core, the SQLite pool, and migrations
//! are all healthy before showing any UI that depends on them.

use serde::Serialize;
use tauri::State;

use crate::error::CmdResult;
use crate::{db::DbHealth, AppState};

#[derive(Serialize, specta::Type)]
pub struct AppVersion {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
}

#[tauri::command]
#[specta::specta]
pub async fn ping() -> String {
    "pong".to_string()
}

#[tauri::command]
#[specta::specta]
pub async fn get_app_version() -> AppVersion {
    AppVersion {
        name: env!("CARGO_PKG_NAME").to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        tauri_version: tauri::VERSION.to_string(),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn db_health(state: State<'_, AppState>) -> CmdResult<DbHealth> {
    // r2d2 returns a synchronous connection — fine on Tauri's command runtime
    // because the task is short.
    Ok(state.db.health()?)
}
