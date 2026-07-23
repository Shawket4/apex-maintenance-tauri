//! Sync commands — thin wrappers over the engine. The UI's contract:
//! `sync_status` is honest (dead letters are counted, never hidden), and every
//! stuck row is visible and actionable through `outbox_list` / retry / discard.

use std::sync::Arc;

use tauri::State;

use crate::error::CmdResult;
use crate::services::engine::{PullSummary, SyncEngine, SyncStatus};
use crate::services::outbox::{self, OutboxItem};
use crate::AppState;

pub struct EngineState(pub Arc<SyncEngine>);

#[tauri::command]
#[specta::specta]
pub async fn sync_status(engine: State<'_, EngineState>) -> CmdResult<SyncStatus> {
    Ok(engine.0.status()?)
}

/// Push then pull, in that order — local intent lands before server rows are
/// applied, so the pull's local-intent guard has the smallest possible window.
#[tauri::command]
#[specta::specta]
pub async fn sync_now(engine: State<'_, EngineState>) -> CmdResult<SyncStatus> {
    let eng = engine.0.clone();
    eng.drain().await?;
    let _: PullSummary = eng.pull().await?;
    Ok(eng.status()?)
}

#[tauri::command]
#[specta::specta]
pub async fn outbox_list(state: State<'_, AppState>) -> CmdResult<Vec<OutboxItem>> {
    let conn = state.db.get()?;
    Ok(outbox::list_active(&conn, 200).map_err(crate::AppError::from)?)
}

#[tauri::command]
#[specta::specta]
pub async fn outbox_retry(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    seq: i64,
) -> CmdResult<()> {
    {
        let conn = state.db.get()?;
        outbox::requeue_dead(&conn, seq).map_err(crate::AppError::from)?;
    }
    let eng = engine.0.clone();
    tauri::async_runtime::spawn(async move {
        let _ = eng.drain().await;
    });
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn outbox_discard(state: State<'_, AppState>, seq: i64) -> CmdResult<()> {
    let conn = state.db.get()?;
    outbox::discard_dead(&conn, seq).map_err(crate::AppError::from)?;
    Ok(())
}
