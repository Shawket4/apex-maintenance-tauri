use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncOp {
    pub entity_type: String,
    pub entity_id: String,
    pub operation: String, // insert, update, delete
    pub payload: JsonValue,
    pub sync_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushBatch {
    pub operations: Vec<SyncOp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushResult {
    pub status: String, // applied, conflict, error
    pub entity_id: String,
    pub new_sync_version: Option<i64>,
    pub server_row: Option<JsonValue>, // for conflict
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushBatchResponse {
    pub results: Vec<PushResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullResponse {
    pub entity_type: String,
    pub rows: Vec<JsonValue>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    pub outbox_count: i64,
    pub conflict_count: i64,
    pub last_sync_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictRecord {
    pub id: i64,
    pub outbox_id: i64,
    pub entity_type: String,
    pub entity_id: String,
    pub local_row: JsonValue,
    pub server_row: JsonValue,
    pub created_at: String,
}
