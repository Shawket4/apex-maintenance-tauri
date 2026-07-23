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

#[derive(Serialize, specta::Type)]
pub struct ServerVersionInfo {
    pub server_version: String,
    pub min_client_version: String,
    /// True when this build is older than the server's declared minimum —
    /// the UI shows an update banner instead of syncing into a broken contract.
    pub update_required: bool,
}

/// Parse "x.y.z" (extra suffixes ignored) for ordering. Unparseable = 0.0.0.
fn semver_triple(s: &str) -> (u64, u64, u64) {
    let mut it = s.trim().trim_start_matches('v').split('.');
    let mut next = || {
        it.next()
            .map(|p| p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>())
            .and_then(|d| d.parse::<u64>().ok())
            .unwrap_or(0)
    };
    (next(), next(), next())
}

/// Compare this build against the server's declared minimum client version.
/// Unauthenticated (an expired session must still learn it needs an update);
/// returns None when the server is unreachable — never blocks startup.
#[tauri::command]
#[specta::specta]
pub async fn server_version_check(state: State<'_, AppState>) -> CmdResult<Option<ServerVersionInfo>> {
    let Ok(raw) = state.http.maint_get_unauth_raw("/health").await else {
        return Ok(None);
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw.body) else {
        return Ok(None);
    };
    let server_version = v
        .get("version")
        .and_then(|x| x.as_str())
        .unwrap_or("unknown")
        .to_string();
    let min = v
        .get("min_client_version")
        .and_then(|x| x.as_str())
        .unwrap_or("0.0.0")
        .to_string();
    let mine = env!("CARGO_PKG_VERSION");
    let update_required = semver_triple(mine) < semver_triple(&min);
    Ok(Some(ServerVersionInfo {
        server_version,
        min_client_version: min,
        update_required,
    }))
}

#[cfg(test)]
mod tests {
    use super::semver_triple;

    #[test]
    fn semver_ordering_is_sane() {
        assert!(semver_triple("0.2.0") < semver_triple("0.10.0"));
        assert!(semver_triple("1.0.0") > semver_triple("0.9.9"));
        assert_eq!(semver_triple("v1.2.3-beta"), (1, 2, 3));
        assert_eq!(semver_triple("garbage"), (0, 0, 0));
    }
}
