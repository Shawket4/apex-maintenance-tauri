//! Owned-domain commands. Pattern for every write: the domain layer applies it
//! locally + enqueues it (one transaction), then we KICK the engine —
//! fire-and-forget — so a healthy network syncs within a second and a dead
//! one costs the user nothing. Reads come from services/views.rs (local
//! truth: mirror ∪ pending outbox, with pending flags).

use serde_json::Value;
use tauri::State;

use crate::commands::sync::EngineState;
use crate::error::CmdResult;
use crate::services::domain::{
    self, ChassisConfig, DismountInput, LegacyTireInput, MountFromStockInput, MountUsedInput,
    OnboardPositionInput,
};
use crate::services::views::{
    self, CategoryRow, ChassisPayload, ClassRow, DueRow, HomeSummary, PlanRow, SearchResults,
    StockView, TireFile, TireRow, TruckRow, WoDetail, WoListRow,
};
use crate::{session_store, AppError, AppResult, AppState};

fn current_user_id(state: &AppState) -> AppResult<i64> {
    let Some(json) = session_store::read_user_json(&state.data_dir)? else {
        return Err(AppError::Unauthorized);
    };
    let v: Value = serde_json::from_str(&json)?;
    v.get("id").and_then(|x| x.as_i64()).ok_or(AppError::Unauthorized)
}

fn kick(engine: &EngineState) {
    let eng = engine.0.clone();
    tauri::async_runtime::spawn(async move {
        let _ = eng.drain().await;
    });
}

// ── view-model reads ─────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn home_summary(state: State<'_, AppState>) -> CmdResult<HomeSummary> {
    Ok(views::home_summary(&state.db)?)
}

#[tauri::command]
#[specta::specta]
pub async fn truck_list(state: State<'_, AppState>, q: Option<String>) -> CmdResult<Vec<TruckRow>> {
    Ok(views::truck_list(&state.db, q.as_deref())?)
}

#[tauri::command]
#[specta::specta]
pub async fn truck_file(state: State<'_, AppState>, vehicle_id: i64) -> CmdResult<Option<TruckRow>> {
    Ok(views::truck_file(&state.db, vehicle_id)?)
}

#[tauri::command]
#[specta::specta]
pub async fn due_board(
    state: State<'_, AppState>,
    vehicle_id: Option<i64>,
) -> CmdResult<Vec<DueRow>> {
    Ok(views::due_board(&state.db, vehicle_id)?)
}

#[tauri::command]
#[specta::specta]
pub async fn wo_list(
    state: State<'_, AppState>,
    status: Option<String>,
    vehicle_id: Option<i64>,
) -> CmdResult<Vec<WoListRow>> {
    Ok(views::wo_list(&state.db, status.as_deref(), vehicle_id)?)
}

#[tauri::command]
#[specta::specta]
pub async fn wo_detail(state: State<'_, AppState>, id: String) -> CmdResult<Option<WoDetail>> {
    Ok(views::wo_detail(&state.db, &id)?)
}

#[tauri::command]
#[specta::specta]
pub async fn tires_list(
    state: State<'_, AppState>,
    status: Option<String>,
    q: Option<String>,
) -> CmdResult<Vec<TireRow>> {
    Ok(views::tires_list(&state.db, status.as_deref(), q.as_deref())?)
}

#[tauri::command]
#[specta::specta]
pub async fn tire_file(state: State<'_, AppState>, id: String) -> CmdResult<Option<TireFile>> {
    Ok(views::tire_file(&state.db, &id)?)
}

#[tauri::command]
#[specta::specta]
pub async fn stock_view(state: State<'_, AppState>) -> CmdResult<StockView> {
    Ok(views::stock_view(&state.db)?)
}

#[tauri::command]
#[specta::specta]
pub async fn chassis_get(
    state: State<'_, AppState>,
    vehicle_id: i64,
) -> CmdResult<Option<ChassisPayload>> {
    Ok(views::chassis_get(&state.db, vehicle_id)?)
}

#[tauri::command]
#[specta::specta]
pub async fn categories_list(state: State<'_, AppState>) -> CmdResult<Vec<CategoryRow>> {
    Ok(views::categories_list(&state.db)?)
}

#[tauri::command]
#[specta::specta]
pub async fn classes_list(state: State<'_, AppState>) -> CmdResult<Vec<ClassRow>> {
    Ok(views::classes_list(&state.db)?)
}

#[tauri::command]
#[specta::specta]
pub async fn plans_list(state: State<'_, AppState>) -> CmdResult<Vec<PlanRow>> {
    Ok(views::plans_list(&state.db)?)
}

#[tauri::command]
#[specta::specta]
pub async fn search_all(state: State<'_, AppState>, q: String) -> CmdResult<SearchResults> {
    Ok(views::search_all(&state.db, &q)?)
}

// ── work orders ──────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn wo_open(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    vehicle_id: i64,
    odometer_at_open: Option<i64>,
) -> CmdResult<String> {
    let uid = current_user_id(&state)?;
    let id = domain::wo_open(&state.db, vehicle_id, odometer_at_open, uid)?;
    kick(&engine);
    Ok(id)
}

#[tauri::command]
#[specta::specta]
pub async fn wo_close(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    id: String,
) -> CmdResult<()> {
    let uid = current_user_id(&state)?;
    domain::wo_close(&state.db, &id, uid)?;
    kick(&engine);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn wo_add_task(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    work_order_id: String,
    category_id: Option<String>,
    description_ar: String,
) -> CmdResult<String> {
    let uid = current_user_id(&state)?;
    let id =
        domain::wo_add_task(&state.db, &work_order_id, category_id.as_deref(), &description_ar, uid)?;
    kick(&engine);
    Ok(id)
}

#[tauri::command]
#[specta::specta]
pub async fn wo_delete_task(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    task_id: String,
) -> CmdResult<()> {
    let uid = current_user_id(&state)?;
    domain::wo_delete_task(&state.db, &task_id, uid)?;
    kick(&engine);
    Ok(())
}

#[derive(Debug, serde::Serialize, specta::Type)]
pub struct OilAddResult {
    pub oil_id: String,
    pub flagged: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn oil_add(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    work_order_id: String,
    vehicle_id: i64,
    oil_type: String,
    liters: f64,
    odometer: Option<i64>,
) -> CmdResult<OilAddResult> {
    let uid = current_user_id(&state)?;
    let (oil_id, flagged) =
        domain::oil_add(&state.db, &work_order_id, vehicle_id, &oil_type, liters, odometer, uid)?;
    kick(&engine);
    Ok(OilAddResult { oil_id, flagged })
}

// ── odometer / class ─────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn override_set(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    vehicle_id: i64,
    odometer: i64,
    notes: Option<String>,
) -> CmdResult<()> {
    let uid = current_user_id(&state)?;
    domain::override_set(&state.db, vehicle_id, odometer, notes.as_deref(), uid)?;
    kick(&engine);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn class_assign(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    vehicle_id: i64,
    class_id: String,
) -> CmdResult<()> {
    let uid = current_user_id(&state)?;
    domain::class_assign(&state.db, vehicle_id, &class_id, uid)?;
    kick(&engine);
    Ok(())
}

// ── tires ────────────────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize, specta::Type)]
pub struct MountResult {
    pub tire_id: String,
    pub assignment_id: String,
}

#[tauri::command]
#[specta::specta]
pub async fn mount_from_stock(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    input: MountFromStockInput,
) -> CmdResult<MountResult> {
    let uid = current_user_id(&state)?;
    let (tire_id, assignment_id) = domain::mount_from_stock(&state.db, &input, uid)?;
    kick(&engine);
    Ok(MountResult { tire_id, assignment_id })
}

#[tauri::command]
#[specta::specta]
pub async fn mount_used(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    input: MountUsedInput,
) -> CmdResult<String> {
    let uid = current_user_id(&state)?;
    let id = domain::mount_used(&state.db, &input, uid)?;
    kick(&engine);
    Ok(id)
}

#[tauri::command]
#[specta::specta]
pub async fn dismount(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    input: DismountInput,
) -> CmdResult<String> {
    let uid = current_user_id(&state)?;
    let tire_id = domain::dismount(&state.db, &input, uid)?;
    kick(&engine);
    Ok(tire_id)
}

#[tauri::command]
#[specta::specta]
pub async fn onboard_position(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    input: OnboardPositionInput,
) -> CmdResult<MountResult> {
    let uid = current_user_id(&state)?;
    let (tire_id, assignment_id) = domain::onboard_position(&state.db, &input, uid)?;
    kick(&engine);
    Ok(MountResult { tire_id, assignment_id })
}

#[tauri::command]
#[specta::specta]
pub async fn intake_legacy(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    tires: Vec<LegacyTireInput>,
) -> CmdResult<Vec<String>> {
    let uid = current_user_id(&state)?;
    let ids = domain::intake_legacy(&state.db, &tires, uid)?;
    kick(&engine);
    Ok(ids)
}

#[tauri::command]
#[specta::specta]
pub async fn tire_set_status(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    tire_id: String,
    to_status: String,
    event_type: String,
    notes: Option<String>,
) -> CmdResult<()> {
    let uid = current_user_id(&state)?;
    domain::tire_set_status(&state.db, &tire_id, &to_status, &event_type, notes.as_deref(), uid)?;
    kick(&engine);
    Ok(())
}

// ── chassis ──────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn chassis_create(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    vehicle_id: i64,
    config: ChassisConfig,
) -> CmdResult<String> {
    let uid = current_user_id(&state)?;
    let id = domain::chassis_create(&state.db, vehicle_id, &config, uid)?;
    kick(&engine);
    Ok(id)
}
