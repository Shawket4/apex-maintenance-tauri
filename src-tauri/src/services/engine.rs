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
use crate::services::schema::{self, columns_for, pk_for};
use crate::{AppError, AppResult};

/// Gate for network-fault parking: how long a batch waits after an
/// offline/auth/portal classification before it becomes due again.
pub const K_OFFLINE_RETRY_MS: i64 = 15_000;

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
///
/// Transport classification is COMPLETE at the source: `From<reqwest::Error>`
/// mints `AppError::Offline` via is_connect()/is_timeout()/is_request(), so an
/// `Http` here is by construction a real server response. String-sniffing its
/// message re-introduced the banned failure mode in the opposite direction —
/// a genuine 5xx whose body said "connection pool exhausted" classified as
/// Offline and retried uncounted forever while the app reported offline.
pub fn classify_push_error(e: &AppError) -> Failure {
    match e {
        AppError::Unauthorized => Failure::AuthExpired,
        AppError::Offline(_) => Failure::Offline,
        other => Failure::Transient(other.to_string()),
    }
}

/// Choose the ops for one push batch out of the due rows.
///
/// Two filters, both load-bearing:
///
/// 1. AT MOST ONE OP PER ENTITY per batch. Failure-while-inflight can leave
///    two pending rows for one entity; sending both in a batch breaks the
///    entity-id result correlation (`find` maps both items to the FIRST
///    result — the second op's conflict was silently acked as applied).
///    The survivor keeps FIFO order; the successor goes in a later batch,
///    rebased by `mark_acked`.
///
/// 2. DEPENDENCY GATING: an op whose parent (by payload FK) has a DEAD op —
///    or whose own entity has a dead predecessor — is held back, uncounted.
///    Without this a dead chassis-layout insert cascades its 35 children
///    into 35 more dead letters; waiting keeps the chain recoverable and
///    surfaces only the root.
fn select_batch(items: Vec<OutboxItem>, dead_ids: &std::collections::HashSet<String>) -> Vec<OutboxItem> {
    let mut seen: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(items.len());
    'items: for item in items {
        if !seen.insert((item.entity_type.clone(), item.entity_id.clone())) {
            continue; // a same-entity predecessor is already in this batch
        }
        if dead_ids.contains(&item.entity_id) {
            continue; // never overtake a dead op for the same entity
        }
        if let Some(meta) = schema::meta(&item.entity_type) {
            if !meta.fk_cols.is_empty() {
                if let Ok(payload) = serde_json::from_str::<Value>(&item.payload) {
                    for fk in meta.fk_cols {
                        if let Some(parent_id) = payload.get(*fk).and_then(|v| v.as_str()) {
                            if dead_ids.contains(parent_id) {
                                continue 'items; // parent is dead — wait, don't cascade
                            }
                        }
                    }
                }
            }
        }
        out.push(item);
    }
    out
}

#[derive(Debug, Clone, Serialize, specta::Type)]
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
    push_batch_size: i64,
    pull_limit: u32,
    last_push_at: std::sync::Mutex<Option<String>>,
    last_pull_at: std::sync::Mutex<Option<String>>,
    last_error: std::sync::Mutex<Option<String>>,
}

impl SyncEngine {
    pub fn new(db: Arc<DbPool>, http: Arc<HttpClient>, push_batch_size: u32, pull_limit: u32) -> Self {
        Self {
            db,
            http,
            drain_lock: tokio::sync::Mutex::new(()),
            online: AtomicBool::new(true),
            auth_paused: AtomicBool::new(false),
            push_batch_size: push_batch_size.clamp(1, 500) as i64,
            pull_limit: pull_limit.clamp(1, 1000),
            last_push_at: std::sync::Mutex::new(None),
            last_pull_at: std::sync::Mutex::new(None),
            last_error: std::sync::Mutex::new(None),
        }
    }

    /// Park a whole batch behind the network gate — uncounted.
    fn park_batch(&self, conn: &rusqlite::Connection, batch: &[OutboxItem]) -> AppResult<()> {
        for item in batch {
            outbox::mark_retry_no_count(conn, item.seq, outbox::now_ms() + K_OFFLINE_RETRY_MS)?;
        }
        Ok(())
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
                let due = outbox::due_for_sync(&conn, outbox::now_ms(), self.push_batch_size)?;
                if due.is_empty() {
                    break;
                }
                let dead_ids = outbox::dead_entity_ids(&conn)?;
                let filtered = select_batch(due, &dead_ids);
                if filtered.is_empty() {
                    // Everything due is gated behind a dead parent — nothing
                    // to send until the user resolves the root dead letter.
                    break;
                }
                filtered
            };

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
                            self.park_batch(&conn, &batch)?;
                            return Ok(()); // network is down for everyone — stop
                        }
                        Failure::AuthExpired => {
                            self.auth_paused.store(true, Ordering::SeqCst);
                            self.set_error(Some("auth expired".into()));
                            self.park_batch(&conn, &batch)?;
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
                        self.park_batch(&conn, &batch)?;
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
                                // a visible dead letter. EXCEPT when a
                                // successor pending row exists for this entity
                                // — its payload is newer local intent, and
                                // clobbering the table would make it lie.
                                // Rebase the successor onto the server version
                                // so it can win legitimately instead.
                                if let Some(row) = &server_row {
                                    let successor =
                                        outbox::has_local_intent(&conn, &item.entity_type, &item.entity_id)?;
                                    if successor {
                                        if let Some(sv) =
                                            row.get("sync_version").and_then(|v| v.as_i64())
                                        {
                                            outbox::rebase_pending(
                                                &conn,
                                                &item.entity_type,
                                                &item.entity_id,
                                                sv,
                                            )?;
                                        }
                                    } else {
                                        let _ = apply_server_row(&conn, &item.entity_type, row);
                                    }
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

        'entities: for meta in schema::ENTITIES {
            let entity = meta.entity;
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
                    "/sync/pull?entity_type={entity}&since={}&limit={}",
                    urlencoding_encode(&since),
                    self.pull_limit
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

                // Rows skipped for local intent must be RE-DELIVERED once the
                // intent resolves — but the server's updated_at never moves
                // for an op that died with a per-op error, so advancing the
                // cursor past a skipped row would orphan it forever. The
                // cursor therefore stops just BEFORE the first skipped row;
                // rows after it still apply (idempotent re-application later).
                let mut first_skip: Option<usize> = None;
                {
                    let mut conn = self.db.get()?;
                    let tx = conn.transaction()?;
                    let pk = pk_for(entity);
                    for (idx, row) in rows.iter().enumerate() {
                        let id = row
                            .get(pk)
                            .map(|v| match v {
                                Value::String(s) => s.clone(),
                                other => other.to_string(),
                            })
                            .unwrap_or_default();
                        if outbox::has_local_intent(&tx, entity, &id)? {
                            summary.skipped_local_intent += 1;
                            first_skip.get_or_insert(idx);
                            continue;
                        }
                        apply_server_row(&tx, entity, row)?;
                        summary.applied += 1;
                    }
                    // Advance the composite cursor — capped at the first skip.
                    let cursor: Option<(String, Option<String>)> = match first_skip {
                        Some(0) => None, // nothing safely consumed — hold position
                        Some(i) => {
                            let prev = &rows[i - 1];
                            prev.get("updated_at").and_then(|v| v.as_str()).map(|ts| {
                                (
                                    ts.to_string(),
                                    prev.get(pk).and_then(|v| v.as_str()).map(str::to_string),
                                )
                            })
                        }
                        None => body.get("next_cursor").and_then(|v| v.as_str()).map(|nc| {
                            (
                                nc.to_string(),
                                body.get("next_cursor_id")
                                    .and_then(|v| v.as_str())
                                    .map(str::to_string),
                            )
                        }),
                    };
                    if let Some((nc, nc_id)) = cursor {
                        since = nc;
                        after_id = nc_id;
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

                if first_skip.is_some() {
                    // Stop paging this entity — the next pull resumes from the
                    // capped cursor once the local intent has resolved.
                    break;
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
        conn.execute_batch(include_str!("../migrations/0005_new_domain.sql")).unwrap();
        conn.execute_batch(include_str!("../migrations/0006_reference_stock.sql")).unwrap();
        conn
    }

    #[test]
    fn apply_server_row_preserves_reals_and_booleans() {
        let c = mem();
        let row = serde_json::json!({
            "id": "oc1", "vehicle_id": 901, "oil_type": "15W-40",
            "liters": 40.5, "odometer": 480000, "flagged": true,
            "performed_at": "2026-07-01T10:00:00Z",
            "created_at": "2026-07-01T10:00:00Z", "updated_at": "2026-07-01T10:00:00Z",
            "created_by_user_id": 1, "updated_by_user_id": 1, "sync_version": 3
        });
        apply_server_row(&c, "oil_changes", &row).unwrap();
        let (liters, flagged): (f64, i64) = c
            .query_row("SELECT liters, flagged FROM oil_changes WHERE id='oc1'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert!((liters - 40.5).abs() < f64::EPSILON, "NUMERIC survives the round-trip");
        assert_eq!(flagged, 1, "JSON true lands as SQLite 1");
    }

    #[test]
    fn apply_server_row_upserts_and_tombstones() {
        let c = mem();
        let mk = |sv: i64, deleted: Option<&str>| {
            serde_json::json!({
                "id": "t1", "dot_code": "DOT X", "brand": "B", "status": "in_stock_used",
                "origin": "legacy", "total_km": 0, "retread_count": 0,
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

    /// Transport classification is complete at the From<reqwest::Error>
    /// source: Offline arrives AS Offline, and an Http is by construction a
    /// real server response — even when its body talks about "connections".
    /// (The old string-sniff classified a 5xx saying "connection pool
    /// exhausted" as Offline: uncounted 15s retries forever, false offline
    /// banner.)
    #[test]
    fn classify_trusts_the_source_taxonomy() {
        assert_eq!(
            classify_push_error(&AppError::Offline("connect refused".into())),
            Failure::Offline
        );
        assert!(matches!(
            classify_push_error(&AppError::Http(
                "500 Internal Server Error — database connection pool timed out".into()
            )),
            Failure::Transient(_)
        ));
        assert_eq!(classify_push_error(&AppError::Unauthorized), Failure::AuthExpired);
    }

    fn item(seq: i64, entity_type: &str, entity_id: &str, payload: Value) -> OutboxItem {
        OutboxItem {
            seq,
            id: format!("op-{seq}"),
            entity_type: entity_type.into(),
            entity_id: entity_id.into(),
            op: "update".into(),
            payload: payload.to_string(),
            base_sync_version: 1,
            status: "pending".into(),
            attempts: 0,
            last_error: None,
            server_row: None,
            enqueued_at: "2026-07-23T00:00:00Z".into(),
        }
    }

    /// Two pending rows for one entity in a single batch break the entity-id
    /// result correlation (both map to the FIRST result — the second op's
    /// conflict was silently acked as applied). Only the first may go.
    #[test]
    fn select_batch_sends_at_most_one_op_per_entity() {
        let dead = std::collections::HashSet::new();
        let out = select_batch(
            vec![
                item(1, "tires", "t1", serde_json::json!({"v": 1})),
                item(2, "tires", "t1", serde_json::json!({"v": 2})),
                item(3, "tires", "t2", serde_json::json!({})),
            ],
            &dead,
        );
        let seqs: Vec<i64> = out.iter().map(|i| i.seq).collect();
        assert_eq!(seqs, vec![1, 3], "successor waits for the next batch (FIFO kept)");
    }

    /// A dead parent gates its children (and a dead predecessor gates its own
    /// entity) — waiting keeps the chain recoverable; cascading dead-letters
    /// 35 chassis children under one dead layout insert.
    #[test]
    fn select_batch_gates_children_of_dead_parents() {
        let mut dead = std::collections::HashSet::new();
        dead.insert("layout-1".to_string());
        let out = select_batch(
            vec![
                item(1, "chassis_axles", "axle-1", serde_json::json!({"layout_id": "layout-1"})),
                item(2, "chassis_axles", "axle-2", serde_json::json!({"layout_id": "layout-2"})),
                item(3, "chassis_layouts", "layout-1", serde_json::json!({})),
            ],
            &dead,
        );
        let seqs: Vec<i64> = out.iter().map(|i| i.seq).collect();
        assert_eq!(
            seqs,
            vec![2],
            "the dead layout's child AND its own successor wait; unrelated ops proceed"
        );
    }
}
