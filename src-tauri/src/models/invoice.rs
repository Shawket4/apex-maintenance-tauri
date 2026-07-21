//! Service-invoice types crossing the Tauri boundary.

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
    #[serde(default, alias = "inspection_items", alias = "InspectionItems", alias = "Items")]
    pub items: Vec<CachedInvoiceItem>,
    #[serde(default, alias = "Car")]
    pub car: Option<Value>,
}

impl CachedInvoice {
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

#[derive(Debug, Clone, Deserialize)]
#[serde(bound(deserialize = "T: serde::Deserialize<'de>"))]
pub struct CachePage<T> {
    #[serde(default, alias = "Data")]
    pub data: Vec<T>,
    #[serde(default, alias = "Pagination")]
    pub pagination: Option<CachePagination>,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
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

/* ---------- projections sent to the JS layer ---------- */

#[derive(Debug, Clone, Serialize, specta::Type)]
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
    pub services_preview: Option<String>,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct InvoiceListResult {
    pub rows: Vec<InvoiceRow>,
    pub total: i64,
    pub page: i32,
    pub limit: i32,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct InvoiceSearchResult {
    pub rows: Vec<InvoiceRow>,
    pub source: SearchSource,
    pub total: i64,
    pub query: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum SearchSource {
    Online,
    Offline,
}

/// Per-item projection inside an invoice detail view.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct InvoiceItemRow {
    pub id: i64,
    pub service: String,
    pub notes: Option<String>,
    pub item_order: Option<i32>,
}

/// Vehicle subset embedded in `InvoiceDetail`. Mirrors what the user's
/// reference detail UI reads off `invoice.car`.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct InvoiceCarInfo {
    pub id: i64,
    pub car_no_plate: String,
    pub car_type: Option<String>,
    pub transporter: Option<String>,
    pub tank_capacity: Option<i32>,
}

/// Full invoice for the detail page — header fields + items + car.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct InvoiceDetail {
    pub id: i64,
    pub car_id: Option<i64>,
    pub date: Option<String>,
    pub plate_number: Option<String>,
    pub driver_name: Option<String>,
    pub supervisor: Option<String>,
    pub operating_region: Option<String>,
    pub meter_reading: Option<i32>,
    pub items: Vec<InvoiceItemRow>,
    pub car: Option<InvoiceCarInfo>,
    pub fetched_at: String,
}
