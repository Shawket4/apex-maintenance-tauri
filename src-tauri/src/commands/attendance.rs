//! Garage attendance commands: the same pattern as `commands::domain` —
//! writes land locally with their outbox rows in one transaction, then the
//! engine is kicked; reads come from `services::views`.

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::commands::domain::{current_user_id, kick};
use crate::commands::sync::EngineState;
use crate::error::CmdResult;
use crate::services::domain::{self, AttendanceMarkInput, AttendanceSettingsInput, WorkerInput};
use crate::services::views::{
    self, AttendanceDayView, AttendanceEmployeeRow, AttendanceMonthView, AttendanceSettingsView, AttendanceWorkerRow,
};
use crate::{AppError, AppState};

// ── reads ────────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn attendance_day(state: State<'_, AppState>, date: String) -> CmdResult<AttendanceDayView> {
    Ok(views::attendance_day(&state.db, &date)?)
}

#[tauri::command]
#[specta::specta]
pub async fn attendance_month(state: State<'_, AppState>, month: String) -> CmdResult<AttendanceMonthView> {
    Ok(views::attendance_month(&state.db, &month)?)
}

#[tauri::command]
#[specta::specta]
pub async fn attendance_workers(state: State<'_, AppState>) -> CmdResult<Vec<AttendanceWorkerRow>> {
    Ok(views::attendance_workers(&state.db)?)
}

#[tauri::command]
#[specta::specta]
pub async fn attendance_settings(state: State<'_, AppState>) -> CmdResult<AttendanceSettingsView> {
    Ok(views::attendance_settings(&state.db)?)
}

#[tauri::command]
#[specta::specta]
pub async fn attendance_employees(state: State<'_, AppState>) -> CmdResult<Vec<AttendanceEmployeeRow>> {
    Ok(views::attendance_employees(&state.db)?)
}

#[derive(Debug, Serialize, specta::Type)]
pub struct EmployeesRefresh {
    pub count: u32,
    /// False when Falcon would not list its employees for this account
    /// (below permission 3): workers can still be typed in by name.
    pub available: bool,
}

/// Fetch Falcon's employees (id, name, type, active) into the local list.
#[tauri::command]
#[specta::specta]
pub async fn attendance_employees_refresh(state: State<'_, AppState>) -> CmdResult<EmployeesRefresh> {
    let raw = state.http.maint_get_raw("/cache/employees").await?;
    let v: Value = serde_json::from_str(&raw.body).map_err(|e| AppError::Http(format!("employees: {e}")))?;
    let available = v.get("available").and_then(Value::as_bool).unwrap_or(false);
    let rows = v.get("employees").and_then(Value::as_array).cloned().unwrap_or_default();
    // A refusal leaves the last list in place rather than emptying it.
    let count = if available { views::replace_employees(&state.db, &rows)? as u32 } else { 0 };
    Ok(EmployeesRefresh { count, available })
}

// ── writes ───────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn attendance_mark(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    input: AttendanceMarkInput,
) -> CmdResult<()> {
    let user = current_user_id(&state)?;
    domain::attendance_mark(&state.db, &input, user)?;
    kick(&engine);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn attendance_mark_many(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    inputs: Vec<AttendanceMarkInput>,
) -> CmdResult<u32> {
    let user = current_user_id(&state)?;
    let n = domain::attendance_mark_many(&state.db, &inputs, user)?;
    kick(&engine);
    Ok(n)
}

#[tauri::command]
#[specta::specta]
pub async fn attendance_settings_set(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    input: AttendanceSettingsInput,
) -> CmdResult<()> {
    let user = current_user_id(&state)?;
    domain::attendance_settings_set(&state.db, &input, user)?;
    kick(&engine);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn worker_add(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    input: WorkerInput,
) -> CmdResult<String> {
    let user = current_user_id(&state)?;
    let id = domain::worker_add(&state.db, &input, user)?;
    kick(&engine);
    Ok(id)
}

#[tauri::command]
#[specta::specta]
pub async fn workers_add_many(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    inputs: Vec<WorkerInput>,
) -> CmdResult<Vec<String>> {
    let user = current_user_id(&state)?;
    let ids = domain::workers_add_many(&state.db, &inputs, user)?;
    kick(&engine);
    Ok(ids)
}

#[tauri::command]
#[specta::specta]
pub async fn worker_update(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    id: String,
    input: WorkerInput,
) -> CmdResult<()> {
    let user = current_user_id(&state)?;
    domain::worker_update(&state.db, &id, &input, user)?;
    kick(&engine);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn worker_delete(state: State<'_, AppState>, engine: State<'_, EngineState>, id: String) -> CmdResult<()> {
    let user = current_user_id(&state)?;
    domain::worker_delete(&state.db, &id, user)?;
    kick(&engine);
    Ok(())
}
