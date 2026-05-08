use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
pub struct CachedDriver {
    pub id: i64,
    pub name: String,
    #[serde(default)] pub mobile_number: Option<String>,
    #[serde(default)] pub transporter: Option<String>,
    #[serde(default)] pub id_license_expiration_date: Option<String>,
    #[serde(default)] pub driver_license_expiration_date: Option<String>,
    #[serde(default)] pub safety_license_expiration_date: Option<String>,
    #[serde(default)] pub drug_test_expiration_date: Option<String>,
    #[serde(default)] pub is_approved: Option<bool>,
    #[serde(default = "default_payload")] pub raw_payload: Value,
    #[serde(default)] pub source_created_at: Option<String>,
    #[serde(default)] pub source_updated_at: Option<String>,
}

fn default_payload() -> Value {
    Value::Object(serde_json::Map::new())
}

#[derive(Debug, Clone, Serialize)]
pub struct DriverRow {
    pub id: i64,
    pub name: String,
    pub mobile_number: Option<String>,
    pub transporter: Option<String>,
    pub id_license_expiration_date: Option<String>,
    pub driver_license_expiration_date: Option<String>,
    pub is_approved: bool,
    pub fetched_at: String,
}
