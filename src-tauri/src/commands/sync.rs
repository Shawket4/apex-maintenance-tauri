//! Sync commands — thin wrappers over the engine. The UI's contract:
//! `sync_status` is honest (dead letters are counted, never hidden), and every
//! stuck row is visible and actionable through `outbox_list` / retry / discard.

use std::sync::Arc;

use tauri::State;

use crate::services::engine::{PullSummary, SyncEngine, SyncStatus};
use crate::services::outbox::{self, OutboxItem};
use crate::{AppResult, AppState};

pub struct EngineState(pub Arc<SyncEngine>);

#[tauri::command]
pub async fn sync_status(engine: State<'_, EngineState>) -> AppResult<SyncStatus> {
    engine.0.status()
}

/// Push then pull, in that order — local intent lands before server rows are
/// applied, so the pull's local-intent guard has the smallest possible window.
#[tauri::command]
pub async fn sync_now(engine: State<'_, EngineState>) -> AppResult<SyncStatus> {
    let eng = engine.0.clone();
    eng.drain().await?;
    let _: PullSummary = eng.pull().await?;
    eng.status()
}

#[tauri::command]
pub async fn outbox_list(state: State<'_, AppState>) -> AppResult<Vec<OutboxItem>> {
    let conn = state.db.get()?;
    Ok(outbox::list_active(&conn, 200)?)
}

#[tauri::command]
pub async fn outbox_retry(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    seq: i64,
) -> AppResult<()> {
    {
        let conn = state.db.get()?;
        outbox::requeue_dead(&conn, seq)?;
    }
    let eng = engine.0.clone();
    tauri::async_runtime::spawn(async move {
        let _ = eng.drain().await;
    });
    Ok(())
}

#[tauri::command]
pub async fn outbox_discard(state: State<'_, AppState>, seq: i64) -> AppResult<()> {
    let conn = state.db.get()?;
    outbox::discard_dead(&conn, seq)?;
    Ok(())
}
