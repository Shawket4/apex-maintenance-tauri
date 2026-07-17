//! Vehicle types crossing the Tauri boundary.
//!
//! Two shapes:
//!  - `CachedVehicle`: what `maint-rust` returns at /api/maint/cache/vehicles.
//!    Mirrors the `vehicles_cache` table from architecture §5.1.
//!  - `VehicleRow`: the smaller projection the UI actually needs to render
//!    the vehicles list.
//!
//! ## Encoding tolerance
//!
//! Falcon uses Go + gorm and the response carries gorm's PascalCase audit
//! fields (`ID`, `CreatedAt`, `UpdatedAt`, `DeletedAt`) alongside the
//! snake_case business fields. We add aliases for both shapes so the same
//! struct works whether the proxy passes through gorm's raw output or
//! transforms it.
//!
//! Decimal columns (lat/long) come through as JSON strings ("30.128996"),
//! and integer columns occasionally do too. Every numeric field uses the
//! lenient deserializers from `util::serde_de`, so we accept both the
//! native JSON type and a string of the type.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::util::serde_de;

#[derive(Debug, Clone, Deserialize)]
pub struct CachedVehicle {
    #[serde(alias = "ID")]
    pub id: i64,

    #[serde(default)]
    pub car_no_plate: String,

    #[serde(default)] pub car_type: Option<String>,
    #[serde(default)] pub transporter: Option<String>,

    #[serde(default, deserialize_with = "serde_de::opt_i32")]
    pub tank_capacity: Option<i32>,

    #[serde(default)] pub json_compartments: Option<Value>,
    #[serde(default)] pub license_expiration_date: Option<String>,
    #[serde(default)] pub calibration_expiration_date: Option<String>,
    #[serde(default)] pub tank_license_expiration_date: Option<String>,

    #[serde(default, deserialize_with = "serde_de::opt_bool")]
    pub is_in_trip: Option<bool>,
    #[serde(default, deserialize_with = "serde_de::opt_bool")]
    pub is_approved: Option<bool>,

    #[serde(default)] pub location: Option<String>,

    #[serde(default, deserialize_with = "serde_de::opt_f64")]
    pub lat: Option<f64>,
    #[serde(default, rename = "long", deserialize_with = "serde_de::opt_f64")]
    pub lng: Option<f64>,

    #[serde(default)] pub location_time_stamp: Option<String>,
    #[serde(default)] pub engine_status: Option<String>,

    #[serde(default, deserialize_with = "serde_de::opt_i32")]
    pub speed: Option<i32>,
    #[serde(default, deserialize_with = "serde_de::opt_i32")]
    pub last_fuel_odometer: Option<i32>,
    #[serde(default)]
    pub mileage: Option<i32>,
    #[serde(default, deserialize_with = "serde_de::opt_i64")]
    pub last_oil_change_id: Option<i64>,
    #[serde(default, deserialize_with = "serde_de::opt_i64")]
    pub driver_id: Option<i64>,

    #[serde(default)] pub operating_company: Option<String>,
    #[serde(default)] pub operating_area: Option<String>,
    #[serde(default)] pub geo_fence: Option<String>,
    #[serde(default)] pub slack_status: Option<String>,
    #[serde(default)] pub last_updated_slack_status: Option<String>,
    #[serde(default)] pub etit_car_id: Option<String>,
    #[serde(default)] pub car_license_url: Option<String>,
    #[serde(default)] pub car_license_back_url: Option<String>,
    #[serde(default)] pub calibration_license_url: Option<String>,
    #[serde(default)] pub calibration_license_back_url: Option<String>,
    #[serde(default)] pub tank_license_url: Option<String>,
    #[serde(default)] pub tank_license_back_url: Option<String>,

    #[serde(default = "default_payload")]
    pub raw_payload: Value,

    /// gorm's `CreatedAt` / `UpdatedAt` / `DeletedAt` come through PascalCase.
    /// We accept either alias (or the snake_case our own server might use).
    #[serde(default, alias = "CreatedAt")]
    pub source_created_at: Option<String>,
    #[serde(default, alias = "UpdatedAt")]
    pub source_updated_at: Option<String>,
    #[serde(default, alias = "DeletedAt")]
    pub source_deleted_at: Option<String>,
}

fn default_payload() -> Value {
    Value::Object(serde_json::Map::new())
}

/// Compact projection sent to the JS layer for list rendering.
#[derive(Debug, Clone, Serialize)]
pub struct VehicleRow {
    pub id: i64,
    pub car_no_plate: String,
    pub car_type: Option<String>,
    pub transporter: Option<String>,
    pub tank_capacity: Option<i32>,
    pub last_fuel_odometer: Option<i32>,
    pub driver_id: Option<i64>,
    pub driver_name: Option<String>,
    pub license_expiration_date: Option<String>,
    pub calibration_expiration_date: Option<String>,
    pub tank_license_expiration_date: Option<String>,
    pub is_in_trip: bool,
    pub is_approved: bool,
    pub source_deleted_at: Option<String>,
    pub fetched_at: String,
}
