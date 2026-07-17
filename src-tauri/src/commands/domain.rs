//! Domain commands. Pattern for every write: the domain layer applies it
//! locally + enqueues it (one transaction), then we KICK the engine —
//! fire-and-forget — so a healthy network syncs within a second and a dead
//! one costs the user nothing.

use serde_json::Value;
use tauri::State;

use crate::commands::sync::EngineState;
use crate::services::domain::{self, ChassisConfig, DueItem, RecordInput, TemplateInput, TireInput};
use crate::{session_store, AppError, AppResult, AppState};

fn current_user_id(state: &AppState) -> AppResult<i64> {
    let Some(json) = session_store::read_user_json(&state.data_dir)? else {
        return Err(AppError::Unauthorized);
    };
    let v: Value = serde_json::from_str(&json)?;
    v.get("id")
        .and_then(|x| x.as_i64())
        .ok_or(AppError::Unauthorized)
}

fn kick(engine: &EngineState) {
    let eng = engine.0.clone();
    tauri::async_runtime::spawn(async move {
        let _ = eng.drain().await;
    });
}

// ── due ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn due_list(state: State<'_, AppState>, vehicle_id: Option<i64>) -> AppResult<Vec<DueItem>> {
    domain::due_list(&state.db, vehicle_id)
}

// ── templates ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn templates_list(state: State<'_, AppState>, vehicle_id: i64) -> AppResult<Vec<Value>> {
    domain::rows_json(
        &state.db,
        "SELECT t.*, c.icon AS category_icon
           FROM maintenance_templates t
           JOIN maintenance_categories c ON c.id = t.category_id
          WHERE t.vehicle_id = ?1 AND t.deleted_at IS NULL
          ORDER BY t.name_en",
        &[&vehicle_id],
    )
}

#[tauri::command]
pub async fn template_create(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    input: TemplateInput,
) -> AppResult<String> {
    let uid = current_user_id(&state)?;
    let id = domain::template_create(&state.db, &input, uid)?;
    kick(&engine);
    Ok(id)
}

#[tauri::command]
pub async fn template_update(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    id: String,
    input: TemplateInput,
) -> AppResult<()> {
    let uid = current_user_id(&state)?;
    domain::template_update(&state.db, &id, &input, uid)?;
    kick(&engine);
    Ok(())
}

#[tauri::command]
pub async fn template_delete(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    id: String,
) -> AppResult<()> {
    let uid = current_user_id(&state)?;
    domain::template_delete(&state.db, &id, uid)?;
    kick(&engine);
    Ok(())
}

// ── records ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn records_list(state: State<'_, AppState>, vehicle_id: i64, limit: Option<i64>) -> AppResult<Vec<Value>> {
    domain::rows_json(
        &state.db,
        "SELECT r.*, c.icon AS category_icon, c.name_ar AS category_name_ar, c.name_en AS category_name_en
           FROM maintenance_records r
           JOIN maintenance_categories c ON c.id = r.category_id
          WHERE r.vehicle_id = ?1 AND r.deleted_at IS NULL
          ORDER BY r.performed_at DESC
          LIMIT ?2",
        &[&vehicle_id, &limit.unwrap_or(200)],
    )
}

#[tauri::command]
pub async fn record_create(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    input: RecordInput,
) -> AppResult<String> {
    let uid = current_user_id(&state)?;
    let id = domain::record_create(&state.db, &input, uid)?;
    kick(&engine);
    Ok(id)
}

#[tauri::command]
pub async fn record_delete(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    id: String,
) -> AppResult<()> {
    let uid = current_user_id(&state)?;
    domain::record_delete(&state.db, &id, uid)?;
    kick(&engine);
    Ok(())
}

// ── odometer override ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn override_set(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    vehicle_id: i64,
    odometer: i64,
    notes: Option<String>,
) -> AppResult<()> {
    let uid = current_user_id(&state)?;
    domain::override_set(&state.db, vehicle_id, odometer, notes.as_deref(), uid)?;
    kick(&engine);
    Ok(())
}

// ── categories (read-only seed data) ─────────────────────────────────────────

#[tauri::command]
pub async fn categories_list(state: State<'_, AppState>) -> AppResult<Vec<Value>> {
    domain::rows_json(
        &state.db,
        "SELECT id, name_ar, name_en, icon FROM maintenance_categories ORDER BY id",
        &[],
    )
}

// ── tires ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn tires_list(state: State<'_, AppState>, status: Option<String>) -> AppResult<Vec<Value>> {
    match status {
        Some(st) => domain::rows_json(
            &state.db,
            "SELECT * FROM tires WHERE deleted_at IS NULL AND status = ?1 ORDER BY updated_at DESC",
            &[&st],
        ),
        None => domain::rows_json(
            &state.db,
            "SELECT * FROM tires WHERE deleted_at IS NULL ORDER BY updated_at DESC",
            &[],
        ),
    }
}

#[tauri::command]
pub async fn tire_history(state: State<'_, AppState>, tire_id: String) -> AppResult<Vec<Value>> {
    domain::rows_json(
        &state.db,
        "SELECT a.*, p.position_code, v.car_no_plate
           FROM tire_assignments a
           JOIN chassis_positions p ON p.id = a.position_id
           JOIN vehicles_cache v    ON v.id = a.vehicle_id
          WHERE a.tire_id = ?1 AND a.deleted_at IS NULL
          ORDER BY a.mounted_at DESC",
        &[&tire_id],
    )
}

#[tauri::command]
pub async fn tire_create(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    input: TireInput,
) -> AppResult<String> {
    let uid = current_user_id(&state)?;
    let id = domain::tire_create(&state.db, &input, uid)?;
    kick(&engine);
    Ok(id)
}

#[tauri::command]
pub async fn tire_mount(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    tire_id: String,
    position_id: String,
    vehicle_id: i64,
    odometer: Option<i64>,
    reason: String,
) -> AppResult<String> {
    let uid = current_user_id(&state)?;
    let id = domain::tire_mount(&state.db, &tire_id, &position_id, vehicle_id, odometer, &reason, uid)?;
    kick(&engine);
    Ok(id)
}

#[tauri::command]
pub async fn tire_dismount(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    assignment_id: String,
    odometer: Option<i64>,
    reason: String,
    to_status: String,
) -> AppResult<()> {
    let uid = current_user_id(&state)?;
    domain::tire_dismount(&state.db, &assignment_id, odometer, &reason, &to_status, uid)?;
    kick(&engine);
    Ok(())
}

// ── chassis ──────────────────────────────────────────────────────────────────

/// The vehicle's chassis as one payload: layout, axles, positions, and the
/// active assignment (with tire) per position — everything the 3D diagram and
/// the mount/dismount flows need in a single invoke.
#[tauri::command]
pub async fn chassis_get(state: State<'_, AppState>, vehicle_id: i64) -> AppResult<Value> {
    let layouts = domain::rows_json(
        &state.db,
        "SELECT * FROM chassis_layouts WHERE vehicle_id = ?1 AND deleted_at IS NULL LIMIT 1",
        &[&vehicle_id],
    )?;
    let Some(layout) = layouts.into_iter().next() else {
        return Ok(Value::Null);
    };
    let layout_id = layout.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let axles = domain::rows_json(
        &state.db,
        "SELECT * FROM chassis_axles WHERE layout_id = ?1 AND deleted_at IS NULL
          ORDER BY section, section_index",
        &[&layout_id],
    )?;
    let positions = domain::rows_json(
        &state.db,
        "SELECT p.*,
                a.id   AS assignment_id,
                a.mounted_at, a.mounted_odometer,
                t.id   AS tire_id, t.dot_code, t.brand, t.status AS tire_status, t.is_retread
           FROM chassis_positions p
           LEFT JOIN tire_assignments a
             ON a.position_id = p.id AND a.dismounted_at IS NULL AND a.deleted_at IS NULL
           LEFT JOIN tires t ON t.id = a.tire_id
          WHERE p.layout_id = ?1 AND p.deleted_at IS NULL
          ORDER BY p.position_code",
        &[&layout_id],
    )?;
    Ok(serde_json::json!({ "layout": layout, "axles": axles, "positions": positions }))
}

#[tauri::command]
pub async fn chassis_create(
    state: State<'_, AppState>,
    engine: State<'_, EngineState>,
    vehicle_id: i64,
    config: ChassisConfig,
) -> AppResult<String> {
    let uid = current_user_id(&state)?;
    let id = domain::chassis_create(&state.db, vehicle_id, &config, uid)?;
    kick(&engine);
    Ok(id)
}
