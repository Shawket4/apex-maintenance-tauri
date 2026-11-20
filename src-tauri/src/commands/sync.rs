//! Sync commands — thin wrappers over the engine. `sync_status` is honest
//! about what is waiting and what was refused; `sync_issues` lists refused
//! changes (already undone locally) so nothing disappears without a trace.

use std::sync::Arc;

use tauri::State;

use crate::error::CmdResult;
use crate::services::engine::{PullSummary, SyncEngine, SyncStatus};
use crate::services::outbox::{self, OutboxItem, SyncIssue};
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

/// Start every pull stream from zero and drop local rows the server does
/// not have. Queued changes are sent first and never dropped.
#[tauri::command]
#[specta::specta]
pub async fn sync_resync(engine: State<'_, EngineState>) -> CmdResult<PullSummary> {
    Ok(engine.0.resync().await?)
}

/// Changes still waiting to reach the server.
#[tauri::command]
#[specta::specta]
pub async fn outbox_list(state: State<'_, AppState>) -> CmdResult<Vec<OutboxItem>> {
    let conn = state.db.get()?;
    Ok(outbox::queued(&conn, 200).map_err(crate::AppError::from)?)
}

/// Changes the server refused. Each was undone locally; `detail` holds what
/// the user had entered.
#[tauri::command]
#[specta::specta]
pub async fn sync_issues(state: State<'_, AppState>) -> CmdResult<Vec<SyncIssue>> {
    let conn = state.db.get()?;
    Ok(outbox::list_issues(&conn, 100).map_err(crate::AppError::from)?)
}

/// Mark one issue (or all of them) as read.
#[tauri::command]
#[specta::specta]
pub async fn sync_issues_seen(state: State<'_, AppState>, id: Option<i64>) -> CmdResult<()> {
    let conn = state.db.get()?;
    outbox::mark_issues_seen(&conn, id).map_err(crate::AppError::from)?;
    Ok(())
}
