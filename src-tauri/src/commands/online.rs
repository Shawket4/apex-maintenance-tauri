//! Online-only commands: things that inherently need the server — AI search
//! over Falcon's history, plans administration (perm ≥3, rare), and the
//! refresh calls that replace the local reference/stock mirrors.
//!
//! Everything else in the app reads local and writes through the outbox.

use serde_json::{json, Value};
use tauri::State;

use crate::error::CmdResult;
use crate::services::refdata;
use crate::services::stock_movements::{self, StockMovementRow};
use crate::{AppError, AppResult, AppState};

async fn get_json(state: &AppState, path: &str) -> AppResult<Value> {
    let raw = state.http.maint_get_raw(path).await?;
    Ok(serde_json::from_str(&raw.body)?)
}

/// Refresh categories + classes + plans mirrors. Called on login/startup
/// (refresh_all_mirrors) and from Settings; safe to call any time online.
#[tauri::command]
#[specta::specta]
pub async fn reference_refresh(state: State<'_, AppState>) -> CmdResult<()> {
    reference_refresh_inner(&state).await
}

pub(crate) async fn reference_refresh_inner(state: &AppState) -> CmdResult<()> {
    let cats = get_json(state, "/categories").await?;
    let classes = get_json(state, "/vehicle-classes").await?;
    let plans = get_json(state, "/service-plans").await?;
    let empty: Vec<Value> = Vec::new();
    refdata::replace_categories(&state.db, cats.as_array().unwrap_or(&empty))?;
    refdata::replace_classes(&state.db, classes.as_array().unwrap_or(&empty))?;
    refdata::replace_plans(&state.db, plans.as_array().unwrap_or(&empty))?;
    Ok(())
}

/// Refresh the stock snapshot mirrors (server also re-mirrors from Falcon on
/// these endpoints).
#[tauri::command]
#[specta::specta]
pub async fn stock_refresh(state: State<'_, AppState>) -> CmdResult<()> {
    stock_refresh_inner(&state).await
}

pub(crate) async fn stock_refresh_inner(state: &AppState) -> CmdResult<()> {
    let tires = get_json(state, "/stock/tires").await?;
    let oil = get_json(state, "/stock/oil").await?;
    let empty: Vec<Value> = Vec::new();
    refdata::replace_tire_stock(&state.db, tires.as_array().unwrap_or(&empty))?;
    refdata::replace_oil_stock(&state.db, oil.as_array().unwrap_or(&empty))?;
    Ok(())
}

/// Day-one blocker fix: the fleet/reference/stock/invoice mirrors used to be
/// populated ONLY by a button buried in Settings — a fresh install (or a
/// second PC) showed an empty app until someone found it. Runs best-effort
/// after login and on startup-with-session; each failure is logged, never
/// fatal (offline first run just stays on local data).
pub(crate) async fn refresh_all_mirrors(state: &AppState) {
    if let Err(e) = crate::commands::cache::vehicles_refresh_inner(state).await {
        tracing::warn!(error = ?e, "bootstrap: vehicles refresh failed");
    }
    if let Err(e) = reference_refresh_inner(state).await {
        tracing::warn!(error = ?e, "bootstrap: reference refresh failed");
    }
    if let Err(e) = stock_refresh_inner(state).await {
        tracing::warn!(error = ?e, "bootstrap: stock refresh failed");
    }
    if let Err(e) = crate::commands::cache::invoices_refresh_inner(state).await {
        tracing::warn!(error = ?e, "bootstrap: invoices refresh failed");
    }
    // Mirror the recent movements window so the ledger is browsable offline.
    if let Ok(v) = get_json(state, "/stock/movements?limit=200&offset=0").await {
        let rows: Vec<Value> = v.as_array().cloned().unwrap_or_default();
        let db = state.db.clone();
        let _ = tokio::task::spawn_blocking(move || {
            if let Ok(mut conn) = db.get() {
                let _ = stock_movements::upsert(&mut conn, &rows);
            }
        })
        .await;
    }
}

/// Upsert a fleet-wide service plan (server-authoritative, perm ≥3), then
/// refresh the local mirror so the due board recomputes immediately.
#[tauri::command]
#[specta::specta]
pub async fn plan_upsert(
    state: State<'_, AppState>,
    class_id: String,
    category_id: String,
    trigger_type: String,
    interval_km: Option<i64>,
    interval_days: Option<i64>,
    is_active: Option<bool>,
) -> CmdResult<()> {
    let body = json!({
        "class_id": class_id, "category_id": category_id, "trigger_type": trigger_type,
        "interval_km": interval_km, "interval_days": interval_days,
        "is_active": is_active,
    });
    state.http.maint_post_raw("/service-plans", &body).await?;
    let plans = get_json(&state, "/service-plans").await?;
    let empty: Vec<Value> = Vec::new();
    refdata::replace_plans(&state.db, plans.as_array().unwrap_or(&empty))?;
    Ok(())
}

/// Create/rename a vehicle class (server-authoritative, perm ≥3), then
/// refresh the reference mirror so the Settings selects update immediately.
#[tauri::command]
#[specta::specta]
pub async fn class_create(
    state: State<'_, AppState>,
    id: String,
    name_ar: String,
) -> CmdResult<()> {
    let body = json!({ "id": id, "name_ar": name_ar });
    state.http.maint_post_raw("/vehicle-classes", &body).await?;
    reference_refresh_inner(&state).await
}

/// Natural-language search over Falcon's service history (Claude tool-use
/// loop server-side; needs ANTHROPIC_API_KEY on maint-rust).
#[tauri::command]
#[specta::specta]
pub async fn ai_query(state: State<'_, AppState>, query: String) -> CmdResult<Value> {
    let raw = state.http.maint_post_raw("/ai/query", &json!({ "query": query })).await?;
    Ok(serde_json::from_str::<Value>(&raw.body).map_err(crate::AppError::from)?)
}

/// Live service events straight from Falcon's DB via maint-rust (fresher than
/// the local invoice cache; the truck history tab uses the local cache first
/// and can deep-refresh with this).
#[tauri::command]
#[specta::specta]
pub async fn service_events(state: State<'_, AppState>, vehicle_id: i64) -> CmdResult<Value> {
    Ok(get_json(&state, &format!("/vehicles/{vehicle_id}/service-events")).await?)
}

/// The stock movements ledger — a LOCAL read over the offline mirror
/// (services::stock_movements), so filter / time-range / pagination work
/// offline. `stock_movements_refresh` keeps the mirror current when online.
/// `kind` filters to "tire" | "oil"; `from` is an inclusive YYYY-MM-DD lower
/// bound (the time range); `limit`/`offset` page through, newest first.
#[tauri::command]
#[specta::specta]
pub async fn stock_movements(
    state: State<'_, AppState>,
    kind: Option<String>,
    from: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> CmdResult<Vec<StockMovementRow>> {
    let limit = limit.unwrap_or(50).clamp(1, 200);
    let offset = offset.unwrap_or(0).max(0);
    let db = state.db.clone();
    Ok(tokio::task::spawn_blocking(move || -> AppResult<Vec<StockMovementRow>> {
        let conn = db.get()?;
        stock_movements::list(&conn, kind.as_deref(), from.as_deref(), limit, offset)
    })
    .await
    .map_err(|e| AppError::Internal(format!("join error: {e}")))??)
}

/// Pull the latest window of movements from maint-rust and upsert the local
/// mirror. Online; best-effort (the view still works offline on the last
/// mirror). Server clamps the page at 200 — a generous recent horizon for
/// this fleet.
#[tauri::command]
#[specta::specta]
pub async fn stock_movements_refresh(state: State<'_, AppState>) -> CmdResult<u32> {
    let v = get_json(&state, "/stock/movements?limit=200&offset=0").await?;
    let rows: Vec<Value> = v.as_array().cloned().unwrap_or_default();
    let db = state.db.clone();
    let n = tokio::task::spawn_blocking(move || -> AppResult<usize> {
        let mut conn = db.get()?;
        stock_movements::upsert(&mut conn, &rows)
    })
    .await
    .map_err(|e| AppError::Internal(format!("join error: {e}")))??;
    Ok(n as u32)
}
