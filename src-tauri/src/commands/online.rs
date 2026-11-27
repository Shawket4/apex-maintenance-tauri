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
    // The catalog is newer than some servers; an older one answers 404.
    match get_json(state, "/catalog").await {
        Ok(v) => refdata::replace_catalog(&state.db, &v)?,
        Err(AppError::Status { status: 404, .. }) => {}
        Err(e) => return Err(e.into()),
    }
    match get_array(state, "/legacy-events").await {
        Ok(rows) => refdata::replace_legacy_events(&state.db, &rows)?,
        Err(AppError::Status { status: 404, .. }) => {}
        Err(e) => return Err(e.into()),
    }
    Ok(())
}

/// The pickers' lists alone: cheap, so it follows every send and every pull
/// (a type typed a minute ago becomes a confirmed entry without a restart).
pub(crate) async fn catalog_refresh_inner(state: &AppState) {
    if let Ok(v) = get_json(state, "/catalog").await {
        if let Err(e) = refdata::replace_catalog(&state.db, &v) {
            tracing::warn!(error = ?e, "catalog refresh failed");
        }
    }
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
    // An older server has no battery stock: keep what we had.
    if let Ok(batteries) = get_array(state, "/stock/batteries").await {
        refdata::replace_battery_stock(&state.db, &batteries)?;
    }
    // Reading stock is when the server learns product names from Falcon's
    // ledger, so the catalog may have just grown.
    if let Ok(v) = get_json(state, "/catalog").await {
        refdata::replace_catalog(&state.db, &v)?;
    }
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

/// Receive new tires into stock (perm ≥4). `ref_id` is minted by the caller
/// once per form submission, so a retry or a double click credits once.
#[tauri::command]
#[specta::specta]
pub async fn stock_credit_tires(
    state: State<'_, AppState>,
    brand: String,
    model: Option<String>,
    size: Option<String>,
    qty: i64,
    ref_id: String,
    note: Option<String>,
) -> CmdResult<()> {
    let body = json!({ "brand": brand, "model": model, "size": size, "qty": qty, "ref_id": ref_id, "note": note });
    state.http.maint_post_raw("/stock/tires/credit", &body).await?;
    stock_refresh_inner(&state).await?;
    let _ = movements_refresh_inner(&state, 7).await;
    Ok(())
}

/// Receive oil into stock (perm ≥4). See `stock_credit_tires` for `ref_id`.
#[tauri::command]
#[specta::specta]
pub async fn stock_credit_oil(
    state: State<'_, AppState>,
    oil_type: String,
    liters: f64,
    ref_id: String,
    note: Option<String>,
) -> CmdResult<()> {
    let body = json!({ "oil_type": oil_type, "liters": liters, "ref_id": ref_id, "note": note });
    state.http.maint_post_raw("/stock/oil/credit", &body).await?;
    stock_refresh_inner(&state).await?;
    let _ = movements_refresh_inner(&state, 7).await;
    Ok(())
}

/// What a stock count changed.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct CountResult {
    pub before: f64,
    pub after: f64,
    /// after − before: negative when the shelf had fewer than the book.
    pub change: f64,
}

fn num(v: &serde_json::Value, k: &str) -> f64 {
    v.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0)
}

/// "We counted N new tires of this type" (perm ≥4): the book figure becomes N.
#[tauri::command]
#[specta::specta]
pub async fn stock_count_tires(
    state: State<'_, AppState>,
    brand: String,
    model: Option<String>,
    size: Option<String>,
    counted: i64,
    ref_id: String,
    note: Option<String>,
) -> CmdResult<CountResult> {
    let body = json!({ "brand": brand, "model": model, "size": size, "counted": counted, "ref_id": ref_id, "note": note });
    let v = state.http.maint_post_raw("/stock/tires/count", &body).await?.body;
    let v: serde_json::Value = serde_json::from_str(&v).unwrap_or_default();
    stock_refresh_inner(&state).await?;
    let _ = movements_refresh_inner(&state, 7).await;
    Ok(CountResult { before: num(&v, "before"), after: num(&v, "on_hand_qty"), change: num(&v, "change") })
}

/// "We measured N liters of this oil" (perm ≥4).
#[tauri::command]
#[specta::specta]
pub async fn stock_count_oil(
    state: State<'_, AppState>,
    oil_type: String,
    counted_liters: f64,
    ref_id: String,
    note: Option<String>,
) -> CmdResult<CountResult> {
    let body = json!({ "oil_type": oil_type, "counted_liters": counted_liters, "ref_id": ref_id, "note": note });
    let v = state.http.maint_post_raw("/stock/oil/count", &body).await?.body;
    let v: serde_json::Value = serde_json::from_str(&v).unwrap_or_default();
    stock_refresh_inner(&state).await?;
    let _ = movements_refresh_inner(&state, 7).await;
    Ok(CountResult { before: num(&v, "before"), after: num(&v, "liters_on_hand"), change: num(&v, "change") })
}

/// Receive new batteries into stock (perm ≥4). See `stock_credit_tires` for `ref_id`.
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn stock_credit_batteries(
    state: State<'_, AppState>,
    spec: crate::services::domain::BatterySpecInput,
    qty: i64,
    ref_id: String,
    note: Option<String>,
) -> CmdResult<()> {
    let body = json!({
        "brand": spec.brand, "model": spec.model, "capacity_ah": spec.capacity_ah, "voltage": spec.voltage,
        "cca": spec.cca, "qty": qty, "ref_id": ref_id, "note": note,
    });
    state.http.maint_post_raw("/stock/batteries/credit", &body).await?;
    stock_refresh_inner(&state).await?;
    let _ = movements_refresh_inner(&state, 7).await;
    Ok(())
}

/// "We counted N new batteries of this type" (perm ≥4).
#[tauri::command]
#[specta::specta]
pub async fn stock_count_batteries(
    state: State<'_, AppState>,
    spec: crate::services::domain::BatterySpecInput,
    counted: i64,
    ref_id: String,
    note: Option<String>,
) -> CmdResult<CountResult> {
    let body = json!({
        "brand": spec.brand, "model": spec.model, "capacity_ah": spec.capacity_ah, "voltage": spec.voltage,
        "cca": spec.cca, "counted": counted, "ref_id": ref_id, "note": note,
    });
    let v = state.http.maint_post_raw("/stock/batteries/count", &body).await?.body;
    let v: serde_json::Value = serde_json::from_str(&v).unwrap_or_default();
    stock_refresh_inner(&state).await?;
    let _ = movements_refresh_inner(&state, 7).await;
    Ok(CountResult { before: num(&v, "before"), after: num(&v, "on_hand_qty"), change: num(&v, "change") })
}

/// Correct a tire product's spelling everywhere (perm ≥3). If the corrected
/// spelling is already a product, the two are merged.
#[tauri::command]
#[specta::specta]
pub async fn catalog_rename_tire_product(
    state: State<'_, AppState>,
    id: String,
    brand: String,
    model: Option<String>,
    size: Option<String>,
) -> CmdResult<()> {
    let body = json!({ "brand": brand, "model": model, "size": size });
    state.http.maint_send_raw("PUT", &format!("/catalog/tire-products/{id}"), &body).await?;
    after_catalog_change(&state).await
}

/// "These two are the same tire": fold `id` into `into` (perm ≥3).
#[tauri::command]
#[specta::specta]
pub async fn catalog_merge_tire_product(state: State<'_, AppState>, id: String, into: String) -> CmdResult<()> {
    state.http.maint_post_raw(&format!("/catalog/tire-products/{id}/merge"), &json!({ "into": into })).await?;
    after_catalog_change(&state).await
}

#[tauri::command]
#[specta::specta]
pub async fn catalog_rename_oil_product(state: State<'_, AppState>, id: String, name: String) -> CmdResult<()> {
    state.http.maint_send_raw("PUT", &format!("/catalog/oil-products/{id}"), &json!({ "name": name })).await?;
    after_catalog_change(&state).await
}

#[tauri::command]
#[specta::specta]
pub async fn catalog_merge_oil_product(state: State<'_, AppState>, id: String, into: String) -> CmdResult<()> {
    state.http.maint_post_raw(&format!("/catalog/oil-products/{id}/merge"), &json!({ "into": into })).await?;
    after_catalog_change(&state).await
}

/// Add a standard job to the list (or edit one when `id` is given, perm ≥3).
#[tauri::command]
#[specta::specta]
pub async fn catalog_save_job(
    state: State<'_, AppState>,
    id: Option<String>,
    name_ar: String,
    name_en: Option<String>,
    category_id: Option<String>,
) -> CmdResult<()> {
    let body = json!({ "name_ar": name_ar, "name_en": name_en, "category_id": category_id });
    match id {
        Some(id) => state.http.maint_send_raw("PUT", &format!("/catalog/standard-jobs/{id}"), &body).await?,
        None => state.http.maint_post_raw("/catalog/standard-jobs", &body).await?,
    };
    after_catalog_change(&state).await
}

#[tauri::command]
#[specta::specta]
pub async fn catalog_remove_job(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.http.maint_delete_raw(&format!("/catalog/standard-jobs/{id}")).await?;
    after_catalog_change(&state).await
}

/// A catalog change rewrites text on tires and oil changes server-side: take
/// the new catalog, the new stock lines, and pull the changed rows.
async fn after_catalog_change(state: &AppState) -> CmdResult<()> {
    reference_refresh_inner(state).await?;
    let _ = stock_refresh_inner(state).await;
    Ok(())
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

// ── route fee lookup (falcon-fees, online only) ──────────────────────────────

/// What the fee service answered, as it is: the shared fee finder reads the
/// status and the JSON body itself.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct FeeApiAnswer {
    pub status: u16,
    pub body: String,
}

/// The endpoints the fee finder may call (read-only lookups and the session).
const FEE_ENDPOINTS: &[&str] = &[
    "/companies", "/terminals", "/drop-offs", "/quote", "/driven", "/routes", "/health", "/auth/session",
];

/// `path` if it is one of the fee finder's endpoints with an optional query —
/// never anything else on that host.
pub fn fee_api_path(path: &str) -> Option<&str> {
    if path.len() > 2000 || path.contains("..") || path.contains('#') || path.contains('\\') || path.chars().any(char::is_control) {
        return None;
    }
    let (route, _query) = path.split_once('?').unwrap_or((path, ""));
    FEE_ENDPOINTS.contains(&route).then_some(path)
}

/// One GET to the route fee lookup service, with this user's FalconGo token
/// (it decides who sees fees). Online only.
#[tauri::command]
#[specta::specta]
pub async fn fee_api(state: State<'_, AppState>, path: String) -> CmdResult<FeeApiAnswer> {
    let path = fee_api_path(&path).ok_or_else(|| AppError::Http(format!("not a fee lookup path: {path}")))?;
    let r = state.http.fees_get(path).await?;
    Ok(FeeApiAnswer { status: r.status.as_u16(), body: r.body })
}

#[cfg(test)]
mod fee_tests {
    use super::fee_api_path;

    #[test]
    fn only_the_fee_finders_endpoints_go_through() {
        for ok in ["/companies", "/terminals?company=X", "/quote?company=A&terminal=B&drop_off=C%20D", "/auth/session"] {
            assert_eq!(fee_api_path(ok), Some(ok), "{ok}");
        }
        for bad in ["/auth/login", "/auth/logout", "/companies/../auth/login", "//evil.example/x", "https://evil.example/", "", "/quote#x", "/companiesX"] {
            assert_eq!(fee_api_path(bad), None, "{bad}");
        }
    }
}
