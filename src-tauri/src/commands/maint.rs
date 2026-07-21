//! Online-first passthrough commands for the new domain (work orders, tires,
//! due, stock). These call maint-rust directly through the shared HttpClient
//! (JWT attached). Writes go through /sync/push so the server applies them with
//! its per-op savepoint semantics. The durable offline outbox (services/engine)
//! is the next layer to route these through; today they require connectivity.

use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

use crate::{AppResult, AppState};

async fn get(state: &AppState, path: &str) -> AppResult<Value> {
    let raw = state.http.maint_get_raw(path).await?;
    Ok(serde_json::from_str(&raw.body)?)
}

async fn push_ops(state: &AppState, ops: Vec<Value>) -> AppResult<Value> {
    let raw = state
        .http
        .maint_post_raw("/sync/push", &json!({ "operations": ops }))
        .await?;
    Ok(serde_json::from_str(&raw.body)?)
}

fn op(entity: &str, id: &str, payload: Value) -> Value {
    json!({
        "entity_type": entity, "entity_id": id, "operation": "insert",
        "sync_version": 0, "payload": payload,
    })
}

// ---- Reads ----

#[tauri::command]
pub async fn maint_vehicles(state: State<'_, AppState>) -> AppResult<Value> {
    get(&state, "/vehicles").await
}

#[tauri::command]
pub async fn maint_categories(state: State<'_, AppState>) -> AppResult<Value> {
    get(&state, "/categories").await
}

#[tauri::command]
pub async fn maint_due(state: State<'_, AppState>, vehicle_id: Option<i64>) -> AppResult<Value> {
    let p = match vehicle_id {
        Some(v) => format!("/due?vehicle_id={v}"),
        None => "/due".to_string(),
    };
    get(&state, &p).await
}

#[tauri::command]
pub async fn maint_work_orders(
    state: State<'_, AppState>,
    status: Option<String>,
    vehicle_id: Option<i64>,
) -> AppResult<Value> {
    let mut q = Vec::new();
    if let Some(s) = status {
        q.push(format!("status={s}"));
    }
    if let Some(v) = vehicle_id {
        q.push(format!("vehicle_id={v}"));
    }
    let path = if q.is_empty() {
        "/work-orders".to_string()
    } else {
        format!("/work-orders?{}", q.join("&"))
    };
    get(&state, &path).await
}

#[tauri::command]
pub async fn maint_work_order_get(state: State<'_, AppState>, id: String) -> AppResult<Value> {
    get(&state, &format!("/work-orders/{id}")).await
}

#[tauri::command]
pub async fn maint_tires(state: State<'_, AppState>, status: Option<String>) -> AppResult<Value> {
    let p = match status {
        Some(s) => format!("/tires?status={s}"),
        None => "/tires".to_string(),
    };
    get(&state, &p).await
}

#[tauri::command]
pub async fn maint_stock_tires(state: State<'_, AppState>) -> AppResult<Value> {
    get(&state, "/stock/tires").await
}

#[tauri::command]
pub async fn maint_stock_oil(state: State<'_, AppState>) -> AppResult<Value> {
    get(&state, "/stock/oil").await
}

// ---- Writes (via /sync/push) ----

#[tauri::command]
pub async fn maint_open_work_order(
    state: State<'_, AppState>,
    vehicle_id: i64,
    title: Option<String>,
    odometer_at_open: Option<i64>,
) -> AppResult<String> {
    let id = Uuid::new_v4().to_string();
    let payload = json!({
        "id": id, "vehicle_id": vehicle_id, "status": "open",
        "title": title, "odometer_at_open": odometer_at_open,
    });
    push_ops(&state, vec![op("work_orders", &id, payload)]).await?;
    Ok(id)
}

#[tauri::command]
pub async fn maint_close_work_order(
    state: State<'_, AppState>,
    id: String,
    sync_version: i64,
) -> AppResult<Value> {
    let payload = json!({ "status": "closed", "closed_at": chrono::Utc::now() });
    let update = json!({
        "entity_type": "work_orders", "entity_id": id, "operation": "update",
        "sync_version": sync_version, "payload": payload,
    });
    push_ops(&state, vec![update]).await
}

#[tauri::command]
pub async fn maint_add_task(
    state: State<'_, AppState>,
    work_order_id: String,
    category_id: Option<String>,
    description_ar: Option<String>,
    description_en: Option<String>,
) -> AppResult<String> {
    let id = Uuid::new_v4().to_string();
    let payload = json!({
        "id": id, "work_order_id": work_order_id, "kind": "free",
        "category_id": category_id, "description_ar": description_ar,
        "description_en": description_en, "is_done": true,
    });
    push_ops(&state, vec![op("work_order_tasks", &id, payload)]).await?;
    Ok(id)
}

#[tauri::command]
pub async fn maint_add_oil_change(
    state: State<'_, AppState>,
    work_order_id: String,
    vehicle_id: i64,
    oil_type: String,
    liters: f64,
    odometer: Option<i64>,
) -> AppResult<String> {
    let flagged = !(34.0..=36.0).contains(&liters);
    let oil_id = Uuid::new_v4().to_string();
    let task_id = Uuid::new_v4().to_string();
    let oil = op(
        "oil_changes",
        &oil_id,
        json!({
            "id": oil_id, "work_order_id": work_order_id, "vehicle_id": vehicle_id,
            "oil_type": oil_type, "liters": liters, "odometer": odometer, "flagged": flagged,
        }),
    );
    let task = op(
        "work_order_tasks",
        &task_id,
        json!({
            "id": task_id, "work_order_id": work_order_id, "kind": "oil",
            "category_id": "oil_change",
            "description_ar": format!("تغيير زيت — {oil_type} — {liters} لتر"),
            "is_done": true,
        }),
    );
    push_ops(&state, vec![oil, task]).await?;

    // Debit the oil stock (§4): records a movement + decrements cache + pushes to Falcon.
    let debit = json!({
        "kind": "oil_debit", "oil_type": oil_type, "liters": liters,
        "ref_id": oil_id, "work_order_id": work_order_id,
    });
    if let Err(e) = state.http.maint_post_raw("/stock/debit", &debit).await {
        tracing::warn!("oil debit push failed: {:?}", e);
    }
    Ok(oil_id)
}

#[tauri::command]
pub async fn maint_service_plans(state: State<'_, AppState>) -> AppResult<Value> {
    get(&state, "/service-plans").await
}

#[tauri::command]
pub async fn maint_upsert_plan(
    state: State<'_, AppState>,
    class_id: String,
    category_id: String,
    trigger_type: String,
    interval_km: Option<i64>,
    interval_days: Option<i64>,
) -> AppResult<Value> {
    let body = json!({
        "class_id": class_id, "category_id": category_id, "trigger_type": trigger_type,
        "interval_km": interval_km, "interval_days": interval_days,
    });
    let raw = state.http.maint_post_raw("/service-plans", &body).await?;
    Ok(serde_json::from_str(&raw.body)?)
}

#[tauri::command]
pub async fn maint_vehicle_classes(state: State<'_, AppState>) -> AppResult<Value> {
    get(&state, "/vehicle-classes").await
}

#[tauri::command]
pub async fn maint_assign_class(
    state: State<'_, AppState>,
    vehicle_id: i64,
    class_id: String,
) -> AppResult<Value> {
    // vehicle_class_assignments PK = vehicle_id; the server upserts on conflict.
    let op = json!({
        "entity_type": "vehicle_class_assignments", "entity_id": vehicle_id.to_string(),
        "operation": "insert", "sync_version": 0,
        "payload": { "vehicle_id": vehicle_id, "class_id": class_id },
    });
    push_ops(&state, vec![op]).await
}

#[tauri::command]
pub async fn maint_service_events(state: State<'_, AppState>, vehicle_id: i64) -> AppResult<Value> {
    get(&state, &format!("/vehicles/{vehicle_id}/service-events")).await
}

#[tauri::command]
pub async fn maint_ai_query(state: State<'_, AppState>, query: String) -> AppResult<Value> {
    let raw = state
        .http
        .maint_post_raw("/ai/query", &json!({ "query": query }))
        .await?;
    Ok(serde_json::from_str(&raw.body)?)
}

#[tauri::command]
pub async fn maint_dev_seed(state: State<'_, AppState>) -> AppResult<Value> {
    let raw = state.http.maint_post_raw("/stock/dev-seed", &json!({})).await?;
    Ok(serde_json::from_str(&raw.body).unwrap_or(json!({"ok": true})))
}
