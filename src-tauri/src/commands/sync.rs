use tauri::State;
use crate::AppState;
use crate::AppResult;
use crate::models::sync::{ConflictRecord, SyncStatus};
use crate::services::sync::SyncService;

#[tauri::command]
pub async fn sync_get_status(state: State<'_, AppState>) -> AppResult<SyncStatus> {
    let sync_service = SyncService::new(state.db.clone(), state.http.clone());
    sync_service.get_status()
}

#[tauri::command]
pub async fn sync_push(state: State<'_, AppState>) -> AppResult<usize> {
    let sync_service = SyncService::new(state.db.clone(), state.http.clone());
    sync_service.push_all().await
}

#[tauri::command]
pub async fn sync_pull(state: State<'_, AppState>) -> AppResult<usize> {
    let sync_service = SyncService::new(state.db.clone(), state.http.clone());
    sync_service.pull_all().await
}

#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> AppResult<(usize, usize)> {
    let sync_service = SyncService::new(state.db.clone(), state.http.clone());
    let pushed = sync_service.push_all().await?;
    let pulled = sync_service.pull_all().await?;
    Ok((pushed, pulled))
}

#[tauri::command]
pub async fn sync_list_conflicts(state: State<'_, AppState>) -> AppResult<Vec<ConflictRecord>> {
    let sync_service = SyncService::new(state.db.clone(), state.http.clone());
    sync_service.list_conflicts()
}

#[tauri::command]
pub async fn sync_resolve_conflict(
    state: State<'_, AppState>,
    conflict_id: i64,
    action: String,
) -> AppResult<()> {
    let sync_service = SyncService::new(state.db.clone(), state.http.clone());
    sync_service.resolve_conflict(conflict_id, &action).await
}
