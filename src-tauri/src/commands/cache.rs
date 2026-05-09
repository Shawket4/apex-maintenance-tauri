//! Phase 2 Tauri commands: cached vehicles / drivers / invoices, plus the
//! online + offline search and per-invoice detail fetch.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    models::{
        cache_freshness::CacheFreshnessRow,
        driver::{CachedDriver, DriverRow},
        invoice::{
            CachePage, CachedInvoice, InvoiceDetail, InvoiceListResult, InvoiceRow,
            InvoiceSearchResult, SearchEnvelope, SearchSource,
        },
        vehicle::{CachedVehicle, VehicleRow},
    },
    services::cache_sync,
    AppError, AppResult, AppState,
};

const CACHE_VEHICLES: &str = "vehicles";
const CACHE_INVOICES: &str = "service_invoices";

/* ========================================================================= *
 *                              VEHICLES                                     *
 * ========================================================================= */

#[derive(Debug, Deserialize)]
struct VehiclesEnvelope {
    #[serde(default)] vehicles: Vec<CachedVehicle>,
    #[serde(default)] drivers: Vec<CachedDriver>,
    #[serde(default)] fetched_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RefreshResult {
    pub upserted: usize,
    pub fetched_at: String,
}

#[tauri::command]
pub async fn vehicles_list(state: State<'_, AppState>) -> AppResult<Vec<VehicleRow>> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || cache_sync::list_vehicles(&db))
        .await
        .map_err(|e| AppError::Internal(format!("join error: {e}")))?
}

#[tauri::command]
pub async fn drivers_list(state: State<'_, AppState>) -> AppResult<Vec<DriverRow>> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || cache_sync::list_drivers(&db))
        .await
        .map_err(|e| AppError::Internal(format!("join error: {e}")))?
}

#[tauri::command]
pub async fn vehicles_refresh(state: State<'_, AppState>) -> AppResult<RefreshResult> {
    let raw = state.http.maint_get_raw("/cache/vehicles").await?;

    let env: VehiclesEnvelope = parse_json(&raw.body, "vehicles cache")?;
    let fetched_at = env.fetched_at.unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    tracing::info!(
        vehicles = env.vehicles.len(),
        drivers = env.drivers.len(),
        "vehicles cache refreshed"
    );

    let db = state.db.clone();
    let ttl = state.config.cache.vehicles_ttl.as_secs();
    let upserted = tokio::task::spawn_blocking(move || -> AppResult<usize> {
        let n = cache_sync::upsert_vehicles_and_drivers(&db, &env.vehicles, &env.drivers)?;
        cache_sync::mark_fresh(&db, CACHE_VEHICLES, ttl)?;
        Ok(n)
    })
    .await
    .map_err(|e| AppError::Internal(format!("join error: {e}")))??;

    Ok(RefreshResult { upserted, fetched_at })
}

/* ========================================================================= *
 *                               INVOICES                                    *
 * ========================================================================= */

#[derive(Debug, Deserialize)]
pub struct InvoicesListArgs {
    #[serde(default = "default_page")] pub page: i32,
    #[serde(default = "default_limit")] pub limit: i32,
    /// Optional vehicle filter — when present, only return that vehicle's
    /// invoices. Drives the per-vehicle drill-down page.
    #[serde(default)] pub car_id: Option<i64>,
}

fn default_page() -> i32 { 1 }
fn default_limit() -> i32 { 50 }

#[tauri::command]
pub async fn invoices_list(
    state: State<'_, AppState>,
    args: InvoicesListArgs,
) -> AppResult<InvoiceListResult> {
    let db = state.db.clone();
    let page = args.page.max(1);
    let limit = args.limit.clamp(1, 500);
    let car_id = args.car_id;
    tokio::task::spawn_blocking(move || cache_sync::list_invoices(&db, car_id, page, limit))
        .await
        .map_err(|e| AppError::Internal(format!("join error: {e}")))?
}

#[derive(Debug, Deserialize)]
pub struct InvoiceGetArgs {
    pub id: i64,
}

#[tauri::command]
pub async fn invoice_get(
    state: State<'_, AppState>,
    args: InvoiceGetArgs,
) -> AppResult<Option<InvoiceDetail>> {
    let db = state.db.clone();
    let id = args.id;
    tokio::task::spawn_blocking(move || cache_sync::get_invoice(&db, id))
        .await
        .map_err(|e| AppError::Internal(format!("join error: {e}")))?
}

#[tauri::command]
pub async fn invoices_refresh(state: State<'_, AppState>) -> AppResult<RefreshResult> {
    let limit = state.config.cache.invoices_page_size.max(1) as i32;
    let mut page = 1;
    let mut total_upserted = 0usize;

    loop {
        let raw = state
            .http
            .maint_get_raw(&format!(
                "/cache/service-invoices?page={}&limit={}",
                page, limit
            ))
            .await?;

        let parsed: CachePage<CachedInvoice> = parse_json(&raw.body, "invoices cache")?;
        let count = parsed.data.len();
        if count == 0 {
            break;
        }

        let last_page = parsed
            .pagination
            .as_ref()
            .and_then(|p| p.total_pages)
            .unwrap_or(0);

        let db = state.db.clone();
        let invoices = parsed.data;
        let upserted = tokio::task::spawn_blocking(move || cache_sync::upsert_invoices(&db, &invoices))
            .await
            .map_err(|e| AppError::Internal(format!("join error: {e}")))??;
        total_upserted += upserted;

        tracing::debug!(
            page,
            limit,
            count,
            upserted,
            total_pages = last_page,
            "invoices page processed"
        );

        if (count as i32) < limit {
            break;
        }
        if last_page > 0 && page as i64 >= last_page {
            break;
        }
        page += 1;
    }

    let db = state.db.clone();
    let ttl = state.config.cache.invoices_ttl.as_secs();
    tokio::task::spawn_blocking(move || cache_sync::mark_fresh(&db, CACHE_INVOICES, ttl))
        .await
        .map_err(|e| AppError::Internal(format!("join error: {e}")))??;

    Ok(RefreshResult {
        upserted: total_upserted,
        fetched_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[derive(Debug, Deserialize)]
pub struct InvoicesSearchArgs {
    pub query: String,
    #[serde(default = "default_search_limit")] pub limit: i32,
}
fn default_search_limit() -> i32 { 50 }

#[tauri::command]
pub async fn invoices_search(
    state: State<'_, AppState>,
    args: InvoicesSearchArgs,
) -> AppResult<InvoiceSearchResult> {
    let trimmed = args.query.trim().to_string();
    if trimmed.is_empty() {
        return Ok(InvoiceSearchResult {
            rows: Vec::new(),
            source: SearchSource::Online,
            total: 0,
            query: trimmed,
        });
    }

    let limit = args.limit.clamp(1, 200);
    let path = format!(
        "/cache/service-invoices/search?query={}&page=1&limit={}",
        urlencoding::encode_simple(&trimmed),
        limit
    );

    match state.http.maint_get_raw(&path).await {
        Ok(raw) => {
            let env: SearchEnvelope<CachedInvoice> = parse_json(&raw.body, "invoices search")?;
            let total = env.total_matches.or(env.invoice_count).unwrap_or(0);

            let db = state.db.clone();
            let invoices_for_cache = env.results.clone();
            tokio::task::spawn_blocking(move || {
                if let Err(e) = cache_sync::upsert_invoices(&db, &invoices_for_cache) {
                    tracing::warn!(error = ?e, "could not mirror search results");
                }
            })
            .await
            .ok();

            let rows = env
                .results
                .into_iter()
                .map(|inv| InvoiceRow {
                    id: inv.id,
                    car_id: inv.effective_car_id(),
                    date: inv.date.clone(),
                    plate_number: inv.effective_plate(),
                    driver_name: inv.driver_name.clone(),
                    supervisor: inv.supervisor.clone(),
                    operating_region: inv.operating_region.clone(),
                    meter_reading: inv.meter_reading,
                    item_count: inv.items.len() as i64,
                    services_preview: preview_for(&inv),
                    fetched_at: chrono::Utc::now().to_rfc3339(),
                })
                .collect();

            Ok(InvoiceSearchResult { rows, source: SearchSource::Online, total, query: trimmed })
        }
        Err(AppError::Http(msg)) => {
            tracing::warn!(error = %msg, "online invoice search failed — falling back to FTS5");
            offline_search(&state, trimmed, limit).await
        }
        Err(AppError::Unauthorized) => Err(AppError::Unauthorized),
        Err(e) => Err(e),
    }
}

async fn offline_search(
    state: &State<'_, AppState>,
    query: String,
    limit: i32,
) -> AppResult<InvoiceSearchResult> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || cache_sync::search_invoices_offline(&db, &query, limit))
        .await
        .map_err(|e| AppError::Internal(format!("join error: {e}")))?
}

fn preview_for(inv: &CachedInvoice) -> Option<String> {
    let mut items: Vec<&str> = inv
        .items
        .iter()
        .map(|i| i.service.as_str())
        .filter(|s| !s.is_empty())
        .collect();
    items.truncate(3);
    if items.is_empty() {
        None
    } else {
        Some(items.join(" • "))
    }
}

/* ========================================================================= *
 *                            CACHE FRESHNESS                                *
 * ========================================================================= */

#[tauri::command]
pub async fn cache_freshness_get(state: State<'_, AppState>) -> AppResult<Vec<CacheFreshnessRow>> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || cache_sync::freshness_all(&db))
        .await
        .map_err(|e| AppError::Internal(format!("join error: {e}")))?
}

/* ========================================================================= *
 *                                  UTILS                                    *
 * ========================================================================= */

fn parse_json<T: serde::de::DeserializeOwned>(body: &str, what: &str) -> AppResult<T> {
    serde_json::from_str::<T>(body).map_err(|e| {
        let snippet: String = body.chars().take(500).collect();
        tracing::error!(
            what = what,
            error = %e,
            body = %snippet,
            "could not decode response body"
        );
        AppError::Http(format!("could not decode {what} response: {e}"))
    })
}

mod urlencoding {
    pub fn encode_simple(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        for b in s.as_bytes() {
            let c = *b;
            let unreserved = c.is_ascii_alphanumeric()
                || c == b'-' || c == b'.' || c == b'_' || c == b'~';
            if unreserved {
                out.push(c as char);
            } else {
                out.push_str(&format!("%{:02X}", c));
            }
        }
        out
    }
}
