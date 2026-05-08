//! Service-invoice types crossing the Tauri boundary.
//!
//! Two wire shapes from `maint-rust`:
//!
//!  - `GET /api/maint/cache/service-invoices?page=N&limit=M`
//!     → `{ data: [InvoiceWithItems], pagination: {..} }`
//!     where each invoice item is nested under `inspection_items`.
//!
//!  - `GET /api/maint/cache/service-invoices/search?query=...`
//!     → `{ results: [InvoiceWithItems], invoice_count, total_matches, ... }`
//!     same per-row shape, with extra ranking fields per-item.
//!
//! Both shapes flatten on the client side into rows on
//! `service_invoices_cache` + `service_invoice_items_cache`.
//!
//! Same encoding tolerance as `vehicle.rs`: gorm aliases for `ID`,
//! `CreatedAt`, `UpdatedAt`, `DeletedAt`; lenient numeric deserializers
//! everywhere a column might come through as a JSON string.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::util::serde_de;

#[derive(Debug, Clone, Deserialize)]
pub struct CachedInvoiceItem {
    #[serde(alias = "ID")]
    pub id: i64,

    #[serde(default, deserialize_with = "serde_de::opt_i64")]
    pub service_invoice_id: Option<i64>,

    #[serde(default)] pub service: String,
    #[serde(default)] pub notes: Option<String>,

    #[serde(default, deserialize_with = "serde_de::opt_i32")]
    pub item_order: Option<i32>,

    #[serde(default = "default_payload")]
    pub raw_payload: Value,

    #[serde(default, alias = "CreatedAt")]
    pub source_created_at: Option<String>,
    #[serde(default, alias = "UpdatedAt")]
    pub source_updated_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CachedInvoice {
    #[serde(alias = "ID")]
    pub id: i64,

    /// Top-level FK to vehicles; gorm tends to call this `CarID` while a
    /// hand-written endpoint uses `car_id`.
    #[serde(default, alias = "CarID", alias = "car_id", deserialize_with = "serde_de::opt_i64")]
    pub car_id: Option<i64>,

    #[serde(default)] pub driver_name: Option<String>,
    #[serde(default)] pub date: Option<String>,

    #[serde(default, deserialize_with = "serde_de::opt_i32")]
    pub meter_reading: Option<i32>,

    #[serde(default)] pub plate_number: Option<String>,
    #[serde(default)] pub supervisor: Option<String>,
    #[serde(default)] pub operating_region: Option<String>,

    #[serde(default = "default_payload")]
    pub raw_payload: Value,

    #[serde(default, alias = "CreatedAt")]
    pub source_created_at: Option<String>,
    #[serde(default, alias = "UpdatedAt")]
    pub source_updated_at: Option<String>,
    #[serde(default, alias = "DeletedAt")]
    pub source_deleted_at: Option<String>,

    /// Items can arrive nested under either `items` or `inspection_items`
    /// (or `InspectionItems` from a gorm-side proxy) depending on which
    /// endpoint produced the response. We accept all three.
    #[serde(default, alias = "inspection_items", alias = "InspectionItems", alias = "Items")]
    pub items: Vec<CachedInvoiceItem>,

    /// `car` may be present as a nested object on search results — captured
    /// here so we can still fall back to `car.plate_number` if the top-level
    /// `plate_number` is missing.
    #[serde(default, alias = "Car")]
    pub car: Option<Value>,
}

impl CachedInvoice {
    /// Best-effort plate accessor, tolerating either flat or nested shapes.
    pub fn effective_plate(&self) -> Option<String> {
        if let Some(p) = self.plate_number.as_ref().filter(|s| !s.is_empty()) {
            return Some(p.clone());
        }
        self.car
            .as_ref()
            .and_then(|c| c.get("plate_number").or_else(|| c.get("PlateNumber")))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }

    /// Effective `car_id` — top-level wins; otherwise the nested `car.id`
    /// (or `car.ID`).
    pub fn effective_car_id(&self) -> Option<i64> {
        if let Some(id) = self.car_id {
            return Some(id);
        }
        self.car
            .as_ref()
            .and_then(|c| c.get("id").or_else(|| c.get("ID")))
            .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
    }
}

fn default_payload() -> Value {
    Value::Object(serde_json::Map::new())
}

/* ------------------------------------------------------------------------- *
 * Pagination shapes the server sends back                                   *
 *                                                                           *
 * Note on the explicit `#[serde(bound(deserialize = ...))]`:                *
 * serde's bound-inference heuristic for generic structs adds a `T: Default` *
 * bound whenever a field has `#[serde(default)]` — even when the field type *
 * is `Vec<T>` and `Vec::<T>::default()` doesn't actually need `T: Default`. *
 * Overriding the bound here narrows it to what's really required.           *
 * ------------------------------------------------------------------------- */

#[derive(Debug, Clone, Deserialize)]
#[serde(bound(deserialize = "T: serde::Deserialize<'de>"))]
pub struct CachePage<T> {
    #[serde(default, alias = "Data")]
    pub data: Vec<T>,
    #[serde(default, alias = "Pagination")]
    pub pagination: Option<CachePagination>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CachePagination {
    #[serde(default, deserialize_with = "serde_de::opt_i32")]
    pub limit: Option<i32>,
    #[serde(default, deserialize_with = "serde_de::opt_i32")]
    pub page: Option<i32>,
    #[serde(default, deserialize_with = "serde_de::opt_i64")]
    pub total: Option<i64>,
    #[serde(rename = "totalPages", alias = "total_pages", default, deserialize_with = "serde_de::opt_i64")]
    pub total_pages: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(bound(deserialize = "T: serde::Deserialize<'de>"))]
pub struct SearchEnvelope<T> {
    #[serde(default)]
    pub results: Vec<T>,
    #[serde(default, deserialize_with = "serde_de::opt_i64")]
    pub invoice_count: Option<i64>,
    #[serde(default, deserialize_with = "serde_de::opt_i64")]
    pub total_matches: Option<i64>,
    #[serde(default)] pub query: Option<String>,
    #[serde(default, deserialize_with = "serde_de::opt_bool")]
    pub success: Option<bool>,
    #[serde(default)] pub pagination: Option<CachePagination>,
}

/* ------------------------------------------------------------------------- *
 * Projections sent to the JS layer                                          *
 * ------------------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize)]
pub struct InvoiceRow {
    pub id: i64,
    pub car_id: Option<i64>,
    pub date: Option<String>,
    pub plate_number: Option<String>,
    pub driver_name: Option<String>,
    pub supervisor: Option<String>,
    pub operating_region: Option<String>,
    pub meter_reading: Option<i32>,
    pub item_count: i64,
    /// First few service strings, joined for preview rendering.
    pub services_preview: Option<String>,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct InvoiceListResult {
    pub rows: Vec<InvoiceRow>,
    pub total: i64,
    pub page: i32,
    pub limit: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct InvoiceSearchResult {
    pub rows: Vec<InvoiceRow>,
    pub source: SearchSource,
    pub total: i64,
    pub query: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchSource {
    Online,
    Offline,
}