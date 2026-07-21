//! The sync engine: drains the outbox to `/sync/push`, pulls server rows from
//! `/sync/pull`, and owns the connectivity/auth state the UI reports.
//!
//! Field rules carried over from the Madar POS core (the architecture, not the
//! code):
//!
//!  * The drain is SINGLE-FLIGHT — a tokio mutex held across the whole body.
//!    Two overlapping drains would snapshot the same backlog and double-send
//!    every row; crash recovery (inflight → pending) is only safe because of
//!    this.
//!  * Failures are a taxonomy, not a boolean. Timeouts and connect errors are
//!    OFFLINE (uncounted — a flaky link almost never gives a clean refusal,
//!    it gives a timeout, and counting those dead-letters real writes).
//!    Server 5xx is a counted retry with exponential backoff. 401 parks the
//!    whole queue until re-auth. Per-op errors from the server dead-letter
//!    only their own op.
//!  * A 200 that doesn't parse as the expected JSON object is treated as
//!    OFFLINE, not success — a captive portal's login page must never ack a
//!    queued write.
//!  * Conflicts are dead-letters that CARRY THE SERVER ROW, and the server row
//!    is applied locally (server-authoritative). The user's rejected payload
//!    stays visible in Diagnostics instead of silently vanishing.
//!  * Pull never clobbers unpushed local intent: rows with a pending/inflight
//!    outbox entry are skipped until that intent resolves.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;
use serde_json::{json, Value};

use crate::db::DbPool;
use crate::http_client::HttpClient;
use crate::services::outbox::{self, OutboxItem};
use crate::{AppError, AppResult};

/// Owned entities, in dependency order: parents sync before the rows that
/// reference them so a fresh pull never trips a foreign key.
pub const ENTITY_TYPES: &[&str] = &[
    "chassis_layouts",
    "chassis_axles",
    "chassis_positions",
    "work_orders",
    "work_order_tasks",
    "oil_changes",
    "vehicle_class_assignments",
    "vehicle_odometer_overrides",
    "tires",
    "tire_assignments",
    "tire_status_events",
];

/// Column lists for applying pulled rows locally. Mirrors the local DDL; the
/// old puller hand-rolled per-table INSERTs and silently NULLed anything whose
/// JSON type surprised it (arrays → None was how every attachment got wiped).
/// Here values go through one JSON-aware extractor instead.
fn columns_for(entity: &str) -> &'static [&'static str] {
    match entity {
        "work_orders" => &[
            "id", "vehicle_id", "status", "title", "odometer_at_open", "opened_at", "closed_at",
            "notes_ar", "notes_en", "created_at", "updated_at", "deleted_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        "work_order_tasks" => &[
            "id", "work_order_id", "kind", "category_id", "description_ar", "description_en",
            "is_done", "sort_order", "created_at", "updated_at", "deleted_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        "oil_changes" => &[
            "id", "work_order_id", "vehicle_id", "oil_type", "liters", "odometer", "flagged",
            "notes", "performed_at", "created_at", "updated_at", "deleted_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        "tire_status_events" => &[
            "id", "tire_id", "event_type", "work_order_id", "from_status", "to_status",
            "notes", "occurred_at", "created_at", "updated_at", "deleted_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        "vehicle_class_assignments" => &[
            "vehicle_id", "class_id", "created_at", "updated_at", "deleted_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        "chassis_layouts" => &[
            "id", "vehicle_id", "name_ar", "name_en", "created_at", "updated_at", "deleted_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        "chassis_axles" => &[
            "id", "layout_id", "section", "section_index", "axle_type", "label_ar", "label_en",
            "is_steering", "is_lifted", "created_at", "updated_at", "deleted_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        "chassis_positions" => &[
            "id", "layout_id", "axle_id", "side", "depth", "is_spare", "spare_index",
            "position_code", "created_at", "updated_at", "deleted_at", "created_by_user_id",
            "updated_by_user_id", "sync_version",
        ],
        "tires" => &[
            "id", "dot_code", "brand", "model", "size", "status", "origin", "total_km",
            "parent_tire_id", "retread_count", "notes_ar", "notes_en",
            "created_at", "updated_at", "deleted_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        "tire_assignments" => &[
            "id", "tire_id", "position_id", "vehicle_id", "work_order_id", "mounted_at",
            "mounted_odometer", "mount_reason", "dismounted_at", "dismounted_odometer",
            "dismount_reason", "notes",
            "created_at", "updated_at", "deleted_at", "created_by_user_id", "updated_by_user_id",
            "sync_version",
        ],
        "vehicle_odometer_overrides" => &[
            "vehicle_id", "odometer", "set_at", "notes", "created_at", "updated_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        _ => &[],
    }
}

/// Public accessor used by the domain layer to snapshot rows for the outbox.
pub fn columns_for_public(entity: &str) -> &'static [&'static str] {
    columns_for(entity)
}

fn pk_for(entity: &str) -> &'static str {
    if entity == "vehicle_odometer_overrides" || entity == "vehicle_class_assignments" {
        "vehicle_id"
    } else {
        "id"
    }
}

/// JSON value → SQLite value, preserving structure. Arrays/objects are stored
/// as canonical JSON text (this is the attachments fix), booleans as 0/1.
fn to_sql(v: Option<&Value>) -> rusqlite::types::Value {
    use rusqlite::types::Value as Sql;
    match v {
        None | Some(Value::Null) => Sql::Null,
        Some(Value::Bool(b)) => Sql::Integer(*b as i64),
        Some(Value::Number(n)) => {
            if let Some(i) = n.as_i64() {
                Sql::Integer(i)
            } else {
                Sql::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Some(Value::String(s)) => Sql::Text(s.clone()),
        Some(other) => Sql::Text(other.to_string()),
    }
}

/// Upsert one pulled server row into its local table.
pub fn apply_server_row(conn: &rusqlite::Connection, entity: &str, row: &Value) -> AppResult<()> {
    let cols = columns_for(entity);
    if cols.is_empty() {
        return Err(AppError::Internal(format!("unknown entity type: {entity}")));
    }
    let placeholders: Vec<String> = (1..=cols.len()).map(|i| format!("?{i}")).collect();
    let updates: Vec<String> = cols
        .iter()
        .filter(|c| **c != pk_for(entity))
        .map(|c| format!("{c} = excluded.{c}"))
        .collect();
    let sql = format!(
        "INSERT INTO {entity} ({}) VALUES ({}) ON CONFLICT({}) DO UPDATE SET {}",
        cols.join(", "),
        placeholders.join(", "),
        pk_for(entity),
        updates.join(", ")
    );
    let values: Vec<rusqlite::types::Value> = cols.iter().map(|c| to_sql(row.get(*c))).collect();
    conn.execute(&sql, rusqlite::params_from_iter(values))?;
    Ok(())
}

// ── outcome classification ───────────────────────────────────────────────────

#[derive(Debug, PartialEq, Eq)]
pub enum Failure {
    /// Transport-level: the network, not the request. Uncounted retry.
    Offline,
    /// The queue must park until the user re-authenticates.
    AuthExpired,
    /// Counted retry with backoff (server 5xx and similar).
    Transient(String),
}

/// Classify a transport/HTTP error from the push call.
pub fn classify_push_error(e: &AppError) -> Failure {
    match e {
        AppError::Unauthorized => Failure::AuthExpired,
        AppError::Offline(_) => Failure::Offline,
        AppError::Http(msg) => {
            // reqwest transport errors arrive stringified through From<reqwest::Error>.
            let m = msg.to_lowercase();
            if m.contains("timed out")
                || m.contains("timeout")
                || m.contains("connect")
                || m.contains("dns")
                || m.contains("network")
                || m.contains("connection")
            {
                Failure::Offline
            } else {
                Failure::Transient(msg.clone())
            }
        }
        other => Failure::Transient(other.to_string()),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncStatus {
    pub online: bool,
    pub auth_paused: bool,
    pub pending: i64,
    pub inflight: i64,
    pub dead: i64,
    pub last_push_at: Option<String>,
    pub last_pull_at: Option<String>,
    pub last_error: Option<String>,
}

pub struct SyncEngine {
    db: Arc<DbPool>,
    http: Arc<HttpClient>,
    drain_lock: tokio::sync::Mutex<()>,
    online: AtomicBool,
    auth_paused: AtomicBool,
    last_push_at: std::sync::Mutex<Option<String>>,
    last_pull_at: std::sync::Mutex<Option<String>>,
    last_error: std::sync::Mutex<Option<String>>,
}

impl SyncEngine {
    pub fn new(db: Arc<DbPool>, http: Arc<HttpClient>) -> Self {
        Self {
            db,
            http,
            drain_lock: tokio::sync::Mutex::new(()),
            online: AtomicBool::new(true),
            auth_paused: AtomicBool::new(false),
            last_push_at: std::sync::Mutex::new(None),
            last_pull_at: std::sync::Mutex::new(None),
            last_error: std::sync::Mutex::new(None),
        }
    }

    pub fn unpark_auth(&self) {
        self.auth_paused.store(false, Ordering::SeqCst);
    }

    pub fn status(&self) -> AppResult<SyncStatus> {
        let conn = self.db.get()?;
        let c = outbox::counts(&conn)?;
        Ok(SyncStatus {
            online: self.online.load(Ordering::SeqCst),
            auth_paused: self.auth_paused.load(Ordering::SeqCst),
            pending: c.pending,
            inflight: c.inflight,
            dead: c.dead,
            last_push_at: self.last_push_at.lock().unwrap().clone(),
            last_pull_at: self.last_pull_at.lock().unwrap().clone(),
            last_error: self.last_error.lock().unwrap().clone(),
        })
    }

    fn set_error(&self, e: Option<String>) {
        *self.last_error.lock().unwrap() = e;
    }

    /// Drain the outbox. Single-flight; safe to call from anywhere, any time.
    pub async fn drain(&self) -> AppResult<()> {
        let _guard = self.drain_lock.lock().await;

        {
            let conn = self.db.get()?;
            outbox::recover_inflight(&conn)?;
            outbox::purge_acked_older_than(&conn, outbox::now_ms() - outbox::K_ACKED_RETENTION_MS)?;
        }

        if self.auth_paused.load(Ordering::SeqCst) {
            return Ok(());
        }

        loop {
            let batch: Vec<OutboxItem> = {
                let conn = self.db.get()?;
                outbox::due_for_sync(&conn, outbox::now_ms(), 50)?
            };
            if batch.is_empty() {
                break;
            }

            {
                let conn = self.db.get()?;
                for item in &batch {
                    outbox::mark_inflight(&conn, item.seq)?;
                }
            }

            let ops: Vec<Value> = batch
                .iter()
                .map(|i| {
                    json!({
                        "entity_type": i.entity_type,
                        "entity_id": i.entity_id,
                        "operation": i.op,
                        "payload": serde_json::from_str::<Value>(&i.payload).unwrap_or(Value::Null),
                        "sync_version": i.base_sync_version,
                    })
                })
                .collect();

            let raw = self
                .http
                .maint_post_raw("/sync/push", &json!({ "operations": ops }))
                .await;

            match raw {
                Err(e) => {
                    let conn = self.db.get()?;
                    match classify_push_error(&e) {
                        Failure::Offline => {
                            self.online.store(false, Ordering::SeqCst);
                            self.set_error(Some("offline".into()));
                            for item in &batch {
                                outbox::mark_retry_no_count(
                                    &conn,
                                    item.seq,
                                    outbox::now_ms() + 15_000,
                                )?;
                            }
                            return Ok(()); // network is down for everyone — stop
                        }
                        Failure::AuthExpired => {
                            self.auth_paused.store(true, Ordering::SeqCst);
                            self.set_error(Some("auth expired".into()));
                            for item in &batch {
                                outbox::mark_retry_no_count(
                                    &conn,
                                    item.seq,
                                    outbox::now_ms() + 15_000,
                                )?;
                            }
                            return Ok(());
                        }
                        Failure::Transient(msg) => {
                            for item in &batch {
                                let next = outbox::now_ms()
                                    + outbox::backoff_ms(item.attempts + 1, item.seq);
                                if item.attempts + 1 >= outbox::K_MAX_RETRIES {
                                    outbox::mark_dead(&conn, item.seq, &msg, None)?;
                                } else {
                                    outbox::mark_retry(&conn, item.seq, &msg, next)?;
                                }
                            }
                            self.set_error(Some(msg));
                            return Ok(());
                        }
                    }
                }
                Ok(resp) => {
                    // Portal guard: a 200 whose body isn't our envelope is NOT an ack.
                    let parsed: Option<Value> = serde_json::from_str(&resp.body).ok();
                    let results = parsed
                        .as_ref()
                        .and_then(|v| v.get("results"))
                        .and_then(|v| v.as_array())
                        .cloned();
                    let Some(results) = results else {
                        let conn = self.db.get()?;
                        self.online.store(false, Ordering::SeqCst);
                        self.set_error(Some("unexpected push response (captive portal?)".into()));
                        for item in &batch {
                            outbox::mark_retry_no_count(&conn, item.seq, outbox::now_ms() + 15_000)?;
                        }
                        return Ok(());
                    };

                    self.online.store(true, Ordering::SeqCst);
                    self.set_error(None);
                    let conn = self.db.get()?;

                    // Correlate by entity_id (never by index — the old client
                    // zipped positionally and panicked on length mismatch).
                    for item in &batch {
                        let mine = results.iter().find(|r| {
                            r.get("entity_id").and_then(|v| v.as_str()) == Some(item.entity_id.as_str())
                        });
                        match mine.and_then(|r| r.get("status").and_then(|s| s.as_str())) {
                            Some("applied") => {
                                let new_sv = mine
                                    .and_then(|r| r.get("new_sync_version"))
                                    .and_then(|v| v.as_i64())
                                    .unwrap_or(item.base_sync_version + 1);
                                outbox::mark_acked(&conn, item.seq, new_sv)?;
                                // Adopt the server's version locally.
                                let table = item.entity_type.as_str();
                                let pk = pk_for(table);
                                let _ = conn.execute(
                                    &format!("UPDATE {table} SET sync_version = ?1 WHERE {pk} = ?2"),
                                    params![new_sv, item.entity_id],
                                );
                            }
                            Some("conflict") => {
                                let server_row = mine.and_then(|r| r.get("server_row")).cloned();
                                // Server-authoritative: converge local state to
                                // the server row; keep the rejected payload as
                                // a visible dead letter.
                                if let Some(row) = &server_row {
                                    let _ = apply_server_row(&conn, &item.entity_type, row);
                                }
                                outbox::mark_dead(
                                    &conn,
                                    item.seq,
                                    "conflict: server version is newer",
                                    server_row.map(|r| r.to_string()).as_deref(),
                                )?;
                            }
                            Some("error") => {
                                let msg = mine
                                    .and_then(|r| r.get("message"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("server rejected the operation");
                                outbox::mark_dead(&conn, item.seq, msg, None)?;
                            }
                            _ => {
                                // No result for this op — treat like a transient.
                                let next = outbox::now_ms()
                                    + outbox::backoff_ms(item.attempts + 1, item.seq);
                                if item.attempts + 1 >= outbox::K_MAX_RETRIES {
                                    outbox::mark_dead(&conn, item.seq, "missing per-op result", None)?;
                                } else {
                                    outbox::mark_retry(&conn, item.seq, "missing per-op result", next)?;
                                }
                            }
                        }
                    }
                    *self.last_push_at.lock().unwrap() =
                        Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
                }
            }
        }
        Ok(())
    }

    /// Pull every entity stream with the composite cursor, applying rows that
    /// don't collide with unpushed local intent.
    pub async fn pull(&self) -> AppResult<PullSummary> {
        // Share the single-flight lock with drain: pull applies rows and must
        // not interleave with a drain's conflict-applies.
        let _guard = self.drain_lock.lock().await;
        let mut summary = PullSummary::default();
        let mut transport_failed = false;

        'entities: for entity in ENTITY_TYPES {
            let (mut since, mut after_id): (String, Option<String>) = {
                let conn = self.db.get()?;
                conn.query_row(
                    "SELECT since, after_id FROM sync_state WHERE entity_type = ?1",
                    params![entity],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap_or(("1970-01-01T00:00:00Z".to_string(), None))
            };

            loop {
                let mut url = format!(
                    "/sync/pull?entity_type={entity}&since={}&limit=200",
                    urlencoding_encode(&since)
                );
                if let Some(aid) = &after_id {
                    url.push_str(&format!("&after_id={}", urlencoding_encode(aid)));
                }

                let raw = match self.http.maint_get_raw(&url).await {
                    Ok(r) => r,
                    Err(AppError::Unauthorized) => {
                        self.auth_paused.store(true, Ordering::SeqCst);
                        return Ok(summary);
                    }
                    Err(e) => {
                        summary.errors.push(format!("{entity}: {e}"));
                        if classify_push_error(&e) == Failure::Offline {
                            // The network is down for every stream — grinding
                            // through the remaining entities just stacks
                            // timeouts. Bail out of the whole pull.
                            self.online.store(false, Ordering::SeqCst);
                            transport_failed = true;
                            break 'entities;
                        }
                        transport_failed = true;
                        break;
                    }
                };
                let body: Value = match serde_json::from_str(&raw.body) {
                    Ok(v) => v,
                    Err(_) => {
                        summary.errors.push(format!("{entity}: non-JSON pull response"));
                        break;
                    }
                };
                let rows = body.get("rows").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                let has_more = body.get("has_more").and_then(|v| v.as_bool()).unwrap_or(false);

                {
                    let mut conn = self.db.get()?;
                    let tx = conn.transaction()?;
                    for row in &rows {
                        let pk = pk_for(entity);
                        let id = row
                            .get(pk)
                            .map(|v| match v {
                                Value::String(s) => s.clone(),
                                other => other.to_string(),
                            })
                            .unwrap_or_default();
                        if outbox::has_local_intent(&tx, entity, &id)? {
                            summary.skipped_local_intent += 1;
                            continue;
                        }
                        apply_server_row(&tx, entity, row)?;
                        summary.applied += 1;
                    }
                    // Advance the composite cursor.
                    if let Some(nc) = body.get("next_cursor").and_then(|v| v.as_str()) {
                        since = nc.to_string();
                        after_id = body
                            .get("next_cursor_id")
                            .and_then(|v| v.as_str())
                            .map(str::to_string);
                        tx.execute(
                            "INSERT INTO sync_state (entity_type, since, after_id, last_pulled_at)
                             VALUES (?1, ?2, ?3, ?4)
                             ON CONFLICT(entity_type) DO UPDATE SET
                               since = excluded.since, after_id = excluded.after_id,
                               last_pulled_at = excluded.last_pulled_at",
                            params![
                                entity,
                                since,
                                after_id,
                                chrono::Utc::now()
                                    .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
                            ],
                        )?;
                    }
                    tx.commit()?;
                }

                if !has_more {
                    break;
                }
            }
        }

        // Only a pull that actually reached the server proves we're online —
        // the unconditional version marked an all-timeouts pull as online.
        if !transport_failed {
            self.online.store(true, Ordering::SeqCst);
            *self.last_pull_at.lock().unwrap() =
                Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
        }
        Ok(summary)
    }
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct PullSummary {
    pub applied: i64,
    pub skipped_local_intent: i64,
    pub errors: Vec<String>,
}

/// Tiny query-string percent-encoder (only what cursor values need).
fn urlencoding_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../migrations/0001_init_schema.sql")).unwrap();
        conn.execute_batch(include_str!("../migrations/0002_seeds.sql")).unwrap();
        conn.execute_batch(include_str!("../migrations/0003_sync_conflicts.sql")).unwrap();
        conn.execute_batch(include_str!("../migrations/0004_offline_engine.sql")).unwrap();
        conn
    }

    #[test]
    fn apply_server_row_preserves_json_attachments() {
        let c = mem();
        let row = serde_json::json!({
            "id": "r1", "vehicle_id": 901, "category_id": "oil_change",
            "performed_at": "2026-07-01T10:00:00Z",
            "odometer_at_service": 480000,
            "attachments": [{"name": "receipt.jpg"}, {"name": "invoice.pdf"}],
            "created_at": "2026-07-01T10:00:00Z", "updated_at": "2026-07-01T10:00:00Z",
            "created_by_user_id": 1, "updated_by_user_id": 1, "sync_version": 3
        });
        apply_server_row(&c, "maintenance_records", &row).unwrap();
        let stored: String = c
            .query_row("SELECT attachments FROM maintenance_records WHERE id='r1'", [], |r| r.get(0))
            .unwrap();
        let parsed: Value = serde_json::from_str(&stored).unwrap();
        assert_eq!(parsed.as_array().unwrap().len(), 2, "attachments survive the round-trip");
    }

    #[test]
    fn apply_server_row_upserts_and_tombstones() {
        let c = mem();
        let mk = |sv: i64, deleted: Option<&str>| {
            serde_json::json!({
                "id": "t1", "dot_code": "DOT X", "brand": "B", "status": "in_stock",
                "is_retread": false, "retread_count": 0,
                "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
                "deleted_at": deleted, "created_by_user_id": 1, "updated_by_user_id": 1,
                "sync_version": sv
            })
        };
        apply_server_row(&c, "tires", &mk(1, None)).unwrap();
        apply_server_row(&c, "tires", &mk(2, Some("2026-07-01T00:00:00Z"))).unwrap();
        let (sv, deleted): (i64, Option<String>) = c
            .query_row("SELECT sync_version, deleted_at FROM tires WHERE id='t1'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(sv, 2);
        assert!(deleted.is_some(), "tombstone applied, not skipped");
    }

    #[test]
    fn classify_maps_timeouts_to_offline_not_transient() {
        let off = classify_push_error(&AppError::Http("error sending request: operation timed out".into()));
        assert_eq!(off, Failure::Offline);
        let off2 = classify_push_error(&AppError::Http("connection refused".into()));
        assert_eq!(off2, Failure::Offline);
        let tr = classify_push_error(&AppError::Http("500 Internal Server Error — boom".into()));
        assert!(matches!(tr, Failure::Transient(_)));
        assert_eq!(classify_push_error(&AppError::Unauthorized), Failure::AuthExpired);
    }
}
