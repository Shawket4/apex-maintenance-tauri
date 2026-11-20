//! Online-only commands: things that inherently need the server — AI search
//! over Falcon's history (apex-rust advisor, maint-rust /ai/query fallback),
//! plans administration (perm ≥3, rare), and the refresh calls that replace
//! the local reference/stock mirrors.
//!
//! Everything else in the app reads local and writes through the outbox.

use serde_json::{json, Value};
use tauri::State;

use crate::error::CmdResult;
use crate::services::history_search::{self, AiSearchResult};
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
    let cats = get_array(state, "/categories").await?;
    let classes = get_array(state, "/vehicle-classes").await?;
    let plans = get_array(state, "/service-plans").await?;
    refdata::replace_categories(&state.db, &cats)?;
    refdata::replace_classes(&state.db, &classes)?;
    refdata::replace_plans(&state.db, &plans)?;
    Ok(())
}

/// A JSON array, or an error. These answers REPLACE a local mirror: anything
/// that is not a list (an error envelope, a portal page) must not empty it.
async fn get_array(state: &AppState, path: &str) -> AppResult<Vec<Value>> {
    match get_json(state, path).await? {
        Value::Array(a) => Ok(a),
        _ => Err(AppError::Http(format!("unexpected answer for {path}"))),
    }
}

/// Refresh the stock snapshot mirrors (server also re-mirrors from Falcon on
/// these endpoints).
#[tauri::command]
#[specta::specta]
pub async fn stock_refresh(state: State<'_, AppState>) -> CmdResult<()> {
    stock_refresh_inner(&state).await
}

pub(crate) async fn stock_refresh_inner(state: &AppState) -> CmdResult<()> {
    let tires = get_array(state, "/stock/tires").await?;
    let oil = get_array(state, "/stock/oil").await?;
    refdata::replace_tire_stock(&state.db, &tires)?;
    refdata::replace_oil_stock(&state.db, &oil)?;
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
    // Mirror the recent movements so the ledger is browsable offline.
    if let Err(e) = movements_refresh_inner(state, 90).await {
        tracing::warn!(error = ?e, "bootstrap: movements refresh failed");
    }
}

/// Mirror every movement of the last `days` days, page by page. (One fixed
/// page of 200 used to be all the app ever held, so the 90-day and "all"
/// filters silently stopped at the 200 newest rows.)
pub(crate) async fn movements_refresh_inner(state: &AppState, days: i64) -> AppResult<u32> {
    let from = (chrono::Utc::now() - chrono::Duration::days(days.clamp(1, 3650))).format("%Y-%m-%d").to_string();
    let mut total = 0u32;
    for page in 0..50i64 {
        let rows = get_array(state, &format!("/stock/movements?limit=200&offset={}&from={from}", page * 200)).await?;
        let n = rows.len();
        let db = state.db.clone();
        tokio::task::spawn_blocking(move || -> AppResult<usize> {
            let mut conn = db.get()?;
            stock_movements::upsert(&mut conn, &rows)
        })
        .await
        .map_err(|e| AppError::Internal(format!("join error: {e}")))??;
        total += n as u32;
        if n < 200 {
            break;
        }
    }
    Ok(total)
}

/// The cheap mirrors (fleet list with odometers, reference data, stock).
/// Runs on the heartbeat; the invoice walk is left to login and manual refresh.
pub(crate) async fn refresh_light_mirrors(state: &AppState) {
    if let Err(e) = crate::commands::cache::vehicles_refresh_inner(state).await {
        tracing::debug!(error = ?e, "heartbeat: vehicles refresh failed");
        return; // offline or signed out: the rest would fail the same way
    }
    let _ = reference_refresh_inner(state).await;
    let _ = stock_refresh_inner(state).await;
}

/// Upsert a fleet-wide service plan (server-authoritative, perm ≥3), then
/// refresh the local mirror so the due board recomputes immediately.
#[tauri::command]
#[specta::specta]
pub async fn plan_upsert(
    state: State<'_, AppState>,
    class_id: String,
    category_id: String,
    interval_km: Option<i64>,
    interval_days: Option<i64>,
    lead_warn_km: Option<i64>,
    lead_warn_days: Option<i64>,
) -> CmdResult<()> {
    // A km interval, a day interval, or both (due on whichever comes first).
    let body = json!({
        "class_id": class_id, "category_id": category_id,
        "interval_km": interval_km, "interval_days": interval_days,
        "lead_warn_km": lead_warn_km, "lead_warn_days": lead_warn_days,
        "is_active": true,
    });
    state.http.maint_post_raw("/service-plans", &body).await?;
    let plans = get_array(&state, "/service-plans").await?;
    refdata::replace_plans(&state.db, &plans)?;
    Ok(())
}

/// Retire a plan (perm ≥3): it leaves the due board on every device.
#[tauri::command]
#[specta::specta]
pub async fn plan_delete(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.http.maint_delete_raw(&format!("/service-plans/{id}")).await?;
    let plans = get_array(&state, "/service-plans").await?;
    refdata::replace_plans(&state.db, &plans)?;
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

/// The AI search box. Service-history lookups go to apex-rust's advisor
/// search (Claude-expanded hybrid search, permission 1+); aggregate fleet
/// questions — and any advisor failure or empty result — go to maint-rust's
/// `/ai/query` (Claude tool-use SQL loop; needs ANTHROPIC_API_KEY there).
/// Routing + fallback policy: services::history_search::search.
#[tauri::command]
#[specta::specta]
pub async fn ai_search(state: State<'_, AppState>, query: String) -> CmdResult<AiSearchResult> {
    let http = &state.http;
    let q = query.trim();
    Ok(history_search::search(
        q,
        || async {
            let body = history_search::advisor_request(q);
            let raw = http
                .rust_post_raw(history_search::ADVISOR_SEARCH_PATH, &body, ADVISOR_TIMEOUT)
                .await?;
            Ok(raw.body)
        },
        || async {
            let raw = http.maint_post_raw("/ai/query", &json!({ "query": q })).await?;
            Ok(raw.body)
        },
    )
    .await?)
}

/// apex-react's advisor search uses the same budget; past it, fall back.
const ADVISOR_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

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

/// Mirror the movements of the last `days` days (default 90) from the server.
/// Online; the view keeps working offline on the last mirror.
#[tauri::command]
#[specta::specta]
pub async fn stock_movements_refresh(state: State<'_, AppState>, days: Option<i64>) -> CmdResult<u32> {
    Ok(movements_refresh_inner(&state, days.unwrap_or(90)).await?)
}
