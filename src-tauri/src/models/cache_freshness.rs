use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct CacheFreshnessRow {
    pub cache_name: String,
    pub fetched_at: String,
    pub ttl_seconds: i64,
    pub is_stale: bool,
}
