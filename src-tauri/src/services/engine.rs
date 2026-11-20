//! The sync engine: sends the outbox to `/sync/push`, reads `/sync/pull`, and
//! owns the connectivity/auth state the UI reports.
//!
//! PUSH
//!  * Single-flight: one tokio mutex around every drain and pull.
//!  * Ops go out in FIFO order, grouped into UNITS (one user action). A unit
//!    is sent whole or not at all, and never overtakes an earlier op on a
//!    record it touches.
//!  * Failures of the REQUEST (offline, 5xx, 429, timeouts, a captive portal)
//!    never count against any op. They back the whole engine off.
//!  * A request the server calls malformed (4xx) is re-sent one unit at a
//!    time, so one bad op cannot sink the other 49.
//!  * Per-op answers:
//!      applied  → acked; later ops on the record move to the new version.
//!      conflict → the server row is taken, the user's queued changes are put
//!                 back on top of it, and the op is retried on the new
//!                 version (field-level merge; the user's own fields win).
//!      error    → the change is undone locally (the record is re-read from
//!                 the server, or removed if the server never had it) and a
//!                 sync issue tells the user what was refused and why.
//!    Nothing is parked forever, so nothing blocks the queue forever.
//!  * Only the signed-in user's ops are sent. Work queued by someone else
//!    waits for them to sign in again; it is never pushed under another name.
//!
//! PULL
//!  * Keyset cursor per entity. A row that cannot be applied is logged and
//!    skipped — it never stops the stream.
//!  * A row with queued local work is not overwritten; it is put on the
//!    refresh list and re-read once that work has gone through.
//!  * `resync` starts every stream from zero and removes local rows the
//!    server does not have (and nothing is queued for).

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;

use rusqlite::{params, Connection, TransactionBehavior};
use serde::Serialize;
use serde_json::{json, Value};

use crate::db::DbPool;
use crate::http_client::HttpClient;
use crate::services::outbox::{self, OutboxItem};
use crate::services::schema::{self, columns_for, pk_for};
use crate::{AppError, AppResult};

/// Wait after a network-level failure before trying again.
pub const K_OFFLINE_RETRY_MS: i64 = 15_000;
/// A request the server refuses outright, alone, this many times is given up.
const K_MAX_REQUEST_REJECTS: i64 = 3;
const K_QUEUE_SCAN: i64 = 2_000;

/// JSON value → SQLite value. Arrays/objects are stored as JSON text,
/// booleans as 0/1.
pub(crate) fn to_sql(v: Option<&Value>) -> rusqlite::types::Value {
    use rusqlite::types::Value as Sql;
    match v {
        None | Some(Value::Null) => Sql::Null,
        Some(Value::Bool(b)) => Sql::Integer(*b as i64),
        Some(Value::Number(n)) => match n.as_i64() {
            Some(i) => Sql::Integer(i),
            None => Sql::Real(n.as_f64().unwrap_or(0.0)),
        },
        Some(Value::String(s)) => Sql::Text(s.clone()),
        Some(other) => Sql::Text(other.to_string()),
    }
}

/// Upsert one server row into its local table.
pub fn apply_server_row(conn: &Connection, entity: &str, row: &Value) -> AppResult<()> {
    let cols = columns_for(entity);
    if cols.is_empty() {
        return Err(AppError::Internal(format!("unknown entity type: {entity}")));
    }
    let pk = pk_for(entity);
    let placeholders: Vec<String> = (1..=cols.len()).map(|i| format!("?{i}")).collect();
    let updates: Vec<String> = cols.iter().filter(|c| **c != pk).map(|c| format!("{c} = excluded.{c}")).collect();
    let sql = format!(
        "INSERT INTO {entity} ({}) VALUES ({}) ON CONFLICT({pk}) DO UPDATE SET {}",
        cols.join(", "),
        placeholders.join(", "),
        updates.join(", ")
    );
    let values: Vec<rusqlite::types::Value> = cols.iter().map(|c| to_sql(row.get(*c))).collect();
    conn.execute(&sql, rusqlite::params_from_iter(values))?;
    Ok(())
}

/// Write a partial payload (an update op's changed columns) onto a local row.
fn apply_patch(conn: &Connection, entity: &str, id: &str, patch: &Value) -> AppResult<()> {
    let Some(obj) = patch.as_object() else { return Ok(()) };
    let cols = columns_for(entity);
    let pk = pk_for(entity);
    let mut sets = Vec::new();
    let mut values: Vec<rusqlite::types::Value> = Vec::new();
    for (k, v) in obj {
        if k != pk && cols.contains(&k.as_str()) && !schema::SERVER_OWNED.contains(&k.as_str()) {
            values.push(to_sql(Some(v)));
            sets.push(format!("{k} = ?{}", values.len()));
        }
    }
    if sets.is_empty() {
        return Ok(());
    }
    values.push(rusqlite::types::Value::Text(id.to_string()));
    let sql = format!("UPDATE {entity} SET {} WHERE {pk} = ?{}", sets.join(", "), values.len());
    conn.execute(&sql, rusqlite::params_from_iter(values))?;
    Ok(())
}

// ── batching ─────────────────────────────────────────────────────────────────

type Key = (String, String);

fn key(i: &OutboxItem) -> Key {
    (i.entity_type.clone(), i.entity_id.clone())
}

/// Records an op's payload points at (its parents).
fn parents(i: &OutboxItem) -> Vec<Key> {
    let Some(meta) = schema::meta(&i.entity_type) else { return Vec::new() };
    if meta.fk_cols.is_empty() {
        return Vec::new();
    }
    let Ok(payload) = serde_json::from_str::<Value>(&i.payload) else { return Vec::new() };
    meta.fk_cols
        .iter()
        .filter_map(|fk| {
            let id = payload.get(*fk)?.as_str()?;
            Some((schema::fk_target(fk)?.to_string(), id.to_string()))
        })
        .collect()
}

/// Split the queue into units (ops of one action) and choose the ones that may
/// go out now. A unit is skipped — and its records blocked for everything
/// behind it — when any member belongs to another user, is still backing off,
/// touches a record already in this batch (versions would be stale), or
/// depends on a blocked record.
pub(crate) fn select_units(queue: Vec<OutboxItem>, user_id: Option<i64>, now_ms: i64, max_ops: usize) -> Vec<Vec<OutboxItem>> {
    let mut units: Vec<Vec<OutboxItem>> = Vec::new();
    let mut by_group: HashMap<String, usize> = HashMap::new();
    for item in queue {
        match item.group_id.clone() {
            Some(g) => match by_group.get(&g) {
                Some(ix) => units[*ix].push(item),
                None => {
                    by_group.insert(g, units.len());
                    units.push(vec![item]);
                }
            },
            None => units.push(vec![item]),
        }
    }

    let mut chosen: Vec<Vec<OutboxItem>> = Vec::new();
    let mut in_batch: HashSet<Key> = HashSet::new();
    let mut blocked: HashSet<Key> = HashSet::new();
    let mut total = 0usize;
    for unit in units {
        let keys: Vec<Key> = unit.iter().map(key).collect();
        let own: HashSet<&Key> = keys.iter().collect();
        let mine = unit.iter().all(|i| i.user_id.is_none() || user_id.is_none() || i.user_id == user_id);
        let due = unit.iter().all(|i| i.next_attempt_at <= now_ms);
        // Two ops on one record inside a unit would carry the same base version.
        let distinct = own.len() == keys.len();
        let clash = keys.iter().any(|k| in_batch.contains(k) || blocked.contains(k));
        let orphan = unit.iter().flat_map(parents).any(|p| blocked.contains(&p));
        let fits = chosen.is_empty() || total + unit.len() <= max_ops;
        if mine && due && distinct && !clash && !orphan && fits {
            total += unit.len();
            in_batch.extend(keys);
            chosen.push(unit);
        } else {
            blocked.extend(keys);
        }
        if total >= max_ops {
            break;
        }
    }
    chosen
}

// ── result processing (pure DB work — unit-tested without a network) ─────────

/// Undo a refused op: drop it from the queue, tell the user, and mark the
/// records it touched to be re-read from the server.
fn reject(conn: &Connection, item: &OutboxItem, code: &str, message: &str, silent: bool) -> AppResult<()> {
    if !silent {
        outbox::add_issue(conn, item, code, message)?;
    }
    outbox::remove(conn, item.seq)?;
    if item.op == "insert" && schema::meta(&item.entity_type).map(|m| m.pk == "id").unwrap_or(true) {
        // The server never took the record: later edits to it are moot.
        outbox::remove_for_entity(conn, &item.entity_type, &item.entity_id)?;
    }
    outbox::want_refresh(conn, &item.entity_type, &item.entity_id)?;
    // Derived state the op changed locally without queueing it.
    let tire: Option<String> = match item.entity_type.as_str() {
        "tire_assignments" | "tire_status_events" => conn
            .query_row(
                &format!("SELECT tire_id FROM {} WHERE id = ?1", item.entity_type),
                params![item.entity_id],
                |r| r.get(0),
            )
            .ok(),
        _ => None,
    };
    if let Some(t) = tire {
        outbox::want_refresh(conn, "tires", &t)?;
    }
    Ok(())
}

/// A conflict on a live row: take the server row, put the user's queued
/// changes back on top, retry on the new version.
fn merge_conflict(conn: &Connection, item: &OutboxItem, server_row: &Value) -> AppResult<()> {
    let entity = item.entity_type.as_str();
    apply_server_row(conn, entity, server_row)?;
    for patch in outbox::queued_update_payloads(conn, entity, &item.entity_id)? {
        apply_patch(conn, entity, &item.entity_id, &patch)?;
    }
    let deleting: i64 = conn.query_row(
        "SELECT COUNT(*) FROM outbox WHERE entity_type = ?1 AND entity_id = ?2
            AND status IN ('pending','inflight') AND op = 'delete'",
        params![entity, item.entity_id],
        |r| r.get(0),
    )?;
    if deleting > 0 && columns_for(entity).contains(&"deleted_at") {
        conn.execute(
            &format!("UPDATE {entity} SET deleted_at = ?2 WHERE {} = ?1", pk_for(entity)),
            params![item.entity_id, outbox::now_iso()],
        )?;
    }
    if let Some(sv) = server_row.get("sync_version").and_then(Value::as_i64) {
        outbox::rebase(conn, entity, &item.entity_id, sv)?;
    }
    Ok(())
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Processed {
    pub acked: usize,
    pub retried: usize,
    pub rejected: usize,
}

/// Apply the server's per-op answers for one unit.
pub(crate) fn process_unit(conn: &Connection, unit: &[OutboxItem], results: &[Value]) -> AppResult<Processed> {
    let mut out = Processed::default();
    let status = |r: &Value| r.get("status").and_then(Value::as_str).unwrap_or("").to_string();
    let code = |r: &Value| r.get("code").and_then(Value::as_str).unwrap_or("").to_string();
    let message = |r: &Value| r.get("message").and_then(Value::as_str).unwrap_or("").to_string();

    if results.iter().all(|r| status(r) == "applied") {
        for (item, r) in unit.iter().zip(results) {
            let new_sv = r.get("new_sync_version").and_then(Value::as_i64).unwrap_or(item.base_sync_version + 1);
            outbox::mark_acked(conn, item, new_sv)?;
            let table = item.entity_type.as_str();
            conn.execute(
                &format!("UPDATE {table} SET sync_version = ?1 WHERE {} = ?2", pk_for(table)),
                params![new_sv, item.entity_id],
            )?;
            out.acked += 1;
        }
        return Ok(out);
    }

    // The unit did not go through. Find the op that stopped it.
    let culprit = unit
        .iter()
        .zip(results)
        .find(|(_, r)| status(r) != "applied" && code(r) != "group_rolled_back");
    let seqs: Vec<i64> = unit.iter().map(|i| i.seq).collect();
    let Some((item, r)) = culprit else {
        // Only "rolled back with the group" answers and nothing to blame —
        // not a state the server produces; try again later.
        for i in unit {
            outbox::retry_later(conn, i.seq, "incomplete answer", outbox::now_ms() + outbox::backoff_ms(i.attempts + 1, i.seq))?;
        }
        out.retried = unit.len();
        return Ok(out);
    };

    let give_up = item.attempts + 1 >= outbox::K_MAX_RETRIES;
    enum Next {
        Retry { error: String, delay: bool },
        Reject { code: String, message: String },
    }
    let next = match status(r).as_str() {
        "conflict" => {
            let server_row = r.get("server_row").filter(|v| v.is_object());
            let server_deleted = server_row.and_then(|s| s.get("deleted_at")).map(|v| !v.is_null()).unwrap_or(false);
            match server_row {
                None => Next::Retry { error: "conflict without a server row".into(), delay: true },
                Some(_) if item.op == "insert" => Next::Reject {
                    code: "duplicate".into(),
                    message: "a different record with this id already exists".into(),
                },
                Some(_) if server_deleted => Next::Reject {
                    code: "conflict_deleted".into(),
                    message: "it was deleted on another device".into(),
                },
                Some(_) if give_up => Next::Reject {
                    code: "conflict".into(),
                    message: "it kept changing on another device".into(),
                },
                Some(row) => {
                    merge_conflict(conn, item, row)?;
                    Next::Retry { error: "merged with a change from another device".into(), delay: false }
                }
            }
        }
        _ => match code(r).as_str() {
            "internal" | "" if !give_up => Next::Retry { error: message(r), delay: true },
            "internal" | "" => Next::Reject { code: "gave_up".into(), message: message(r) },
            c => Next::Reject { code: c.to_string(), message: message(r) },
        },
    };

    match next {
        Next::Retry { error, delay } => {
            // The whole unit waits together, so it is re-sent together.
            let at = if delay { outbox::now_ms() + outbox::backoff_ms(item.attempts + 1, item.seq) } else { 0 };
            outbox::retry_later(conn, item.seq, &error, at)?;
            for i in unit.iter().filter(|i| i.seq != item.seq) {
                conn.execute(
                    "UPDATE outbox SET status = 'pending', next_attempt_at = ?2 WHERE seq = ?1",
                    params![i.seq, at],
                )?;
            }
            out.retried = unit.len();
        }
        Next::Reject { code, message } => {
            reject(conn, item, &code, &message, false)?;
            for i in unit.iter().filter(|i| i.seq != item.seq) {
                reject(conn, i, "group_rolled_back", "", true)?;
            }
            out.rejected = unit.len();
        }
    }
    let _ = seqs;
    Ok(out)
}

// ── engine ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct SyncStatus {
    pub online: bool,
    /// The session is not accepted any more (expired or access removed).
    pub auth_paused: bool,
    /// Changes waiting to reach the server.
    pub pending: i64,
    /// Of those, queued by a different user than the one signed in.
    pub other_user_pending: i64,
    /// Refused changes the user has not looked at yet.
    pub issues: i64,
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
    /// Engine-level backoff after a failed request (epoch ms; 0 = open).
    gate_until: AtomicI64,
    gate_fails: AtomicI64,
    /// After a 4xx on a multi-unit request: send one unit at a time.
    one_at_a_time: AtomicBool,
    push_batch_size: usize,
    pull_limit: u32,
    last_push_at: std::sync::Mutex<Option<String>>,
    last_pull_at: std::sync::Mutex<Option<String>>,
    last_error: std::sync::Mutex<Option<String>>,
}

fn stamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

impl SyncEngine {
    pub fn new(db: Arc<DbPool>, http: Arc<HttpClient>, push_batch_size: u32, pull_limit: u32) -> Self {
        Self {
            db,
            http,
            drain_lock: tokio::sync::Mutex::new(()),
            online: AtomicBool::new(true),
            auth_paused: AtomicBool::new(false),
            gate_until: AtomicI64::new(0),
            gate_fails: AtomicI64::new(0),
            one_at_a_time: AtomicBool::new(false),
            push_batch_size: push_batch_size.clamp(1, 200) as usize,
            pull_limit: pull_limit.clamp(1, 1000),
            last_push_at: std::sync::Mutex::new(None),
            last_pull_at: std::sync::Mutex::new(None),
            last_error: std::sync::Mutex::new(None),
        }
    }

    fn current_user(&self) -> Option<i64> {
        let json = crate::session_store::read_user_json(self.http.data_dir()).ok()??;
        serde_json::from_str::<Value>(&json).ok()?.get("id")?.as_i64().filter(|id| *id > 0)
    }

    /// A fresh sign-in: the session works again and nothing should wait.
    pub fn unpark_auth(&self) {
        self.auth_paused.store(false, Ordering::SeqCst);
        self.gate_until.store(0, Ordering::SeqCst);
        self.gate_fails.store(0, Ordering::SeqCst);
        self.set_error(None);
    }

    pub fn status(&self) -> AppResult<SyncStatus> {
        let conn = self.db.get()?;
        let c = outbox::counts(&conn, self.current_user())?;
        Ok(SyncStatus {
            online: self.online.load(Ordering::SeqCst),
            auth_paused: self.auth_paused.load(Ordering::SeqCst),
            pending: c.pending,
            other_user_pending: c.other_user,
            issues: outbox::unseen_issue_count(&conn)?,
            last_push_at: self.last_push_at.lock().unwrap().clone(),
            last_pull_at: self.last_pull_at.lock().unwrap().clone(),
            last_error: self.last_error.lock().unwrap().clone(),
        })
    }

    fn set_error(&self, e: Option<String>) {
        *self.last_error.lock().unwrap() = e;
    }

    /// The request failed, not the ops: wait, then try the same ops again.
    fn back_off(&self, reason: &str, network: bool) {
        let fails = self.gate_fails.fetch_add(1, Ordering::SeqCst) + 1;
        let wait = if network { K_OFFLINE_RETRY_MS } else { outbox::backoff_ms(fails, 1).max(K_OFFLINE_RETRY_MS) };
        self.gate_until.store(outbox::now_ms() + wait, Ordering::SeqCst);
        if network {
            self.online.store(false, Ordering::SeqCst);
        }
        self.set_error(Some(reason.to_string()));
    }

    /// Classify a failed request. Returns true when the caller should stop.
    fn request_failed(&self, e: &AppError) -> bool {
        match e {
            AppError::Unauthorized => {
                self.auth_paused.store(true, Ordering::SeqCst);
                self.set_error(Some("session_expired".into()));
            }
            AppError::Status { status: 403, .. } => {
                self.auth_paused.store(true, Ordering::SeqCst);
                self.set_error(Some("forbidden".into()));
            }
            AppError::Offline(_) => self.back_off("offline", true),
            other => self.back_off(&other.to_string(), false),
        }
        true
    }

    /// Pre-v2 builds parked refused ops forever and held everything behind
    /// them. Turn each into the v2 outcome: undone, with a note for the user.
    fn resolve_legacy_dead(&self, conn: &Connection) -> AppResult<()> {
        for item in outbox::legacy_dead(conn)? {
            let msg = item.last_error.clone().unwrap_or_default();
            let code = if msg.starts_with("conflict") { "conflict" } else { "rejected" };
            reject(conn, &item, code, &msg, false)?;
        }
        Ok(())
    }

    /// Send the outbox. Single-flight; safe to call from anywhere, any time.
    pub async fn drain(&self) -> AppResult<()> {
        let _guard = self.drain_lock.lock().await;
        self.drain_locked().await?;
        self.refresh_locked().await;
        Ok(())
    }

    async fn drain_locked(&self) -> AppResult<()> {
        {
            let conn = self.db.get()?;
            outbox::recover_inflight(&conn)?;
            outbox::purge_acked_older_than(&conn, outbox::now_ms() - outbox::K_ACKED_RETENTION_MS)?;
            self.resolve_legacy_dead(&conn)?;
        }
        if self.auth_paused.load(Ordering::SeqCst) {
            return Ok(());
        }
        let Some(user) = self.current_user() else { return Ok(()) };

        loop {
            if outbox::now_ms() < self.gate_until.load(Ordering::SeqCst) {
                return Ok(());
            }
            let single = self.one_at_a_time.load(Ordering::SeqCst);
            let units: Vec<Vec<OutboxItem>> = {
                let conn = self.db.get()?;
                let queue = outbox::queued(&conn, K_QUEUE_SCAN)?;
                let mut units = select_units(queue, Some(user), outbox::now_ms(), self.push_batch_size);
                if single {
                    units.truncate(1);
                }
                units
            };
            if units.is_empty() {
                self.one_at_a_time.store(false, Ordering::SeqCst);
                return Ok(());
            }
            let seqs: Vec<i64> = units.iter().flatten().map(|i| i.seq).collect();
            {
                let conn = self.db.get()?;
                outbox::mark_sent(&conn, &seqs)?;
            }

            let ops: Vec<Value> = units
                .iter()
                .flatten()
                .map(|i| {
                    json!({
                        "op_id": i.id,
                        "group_id": i.group_id,
                        "entity_type": i.entity_type,
                        "entity_id": i.entity_id,
                        "operation": i.op,
                        "payload": serde_json::from_str::<Value>(&i.payload).unwrap_or_else(|_| json!({})),
                        "sync_version": if i.op == "insert" { 0 } else { i.base_sync_version },
                    })
                })
                .collect();
            let sent = ops.len();

            match self.http.maint_post_raw("/sync/push", &json!({ "operations": ops })).await {
                Err(e) => {
                    let conn = self.db.get()?;
                    outbox::release(&conn, &seqs)?;
                    // The server read the request and called it wrong.
                    let refused = matches!(&e, AppError::Status { status, .. } if matches!(status, 400 | 413 | 422));
                    if !refused {
                        self.request_failed(&e);
                        return Ok(());
                    }
                    if units.len() > 1 {
                        // Find the unit at fault by sending them one by one.
                        self.one_at_a_time.store(true, Ordering::SeqCst);
                        continue;
                    }
                    let unit = &units[0];
                    let attempts = unit.iter().map(|i| i.attempts).max().unwrap_or(0) + 1;
                    if attempts >= K_MAX_REQUEST_REJECTS {
                        for (n, i) in unit.iter().enumerate() {
                            reject(&conn, i, "rejected", &e.to_string(), n > 0)?;
                        }
                    } else {
                        for i in unit {
                            outbox::retry_later(&conn, i.seq, &e.to_string(), outbox::now_ms() + outbox::backoff_ms(attempts, i.seq))?;
                        }
                    }
                }
                Ok(resp) => {
                    // A 200 that is not our envelope (a captive portal's login
                    // page) acknowledges nothing.
                    let results = serde_json::from_str::<Value>(&resp.body)
                        .ok()
                        .and_then(|v| v.get("results").and_then(Value::as_array).cloned())
                        .filter(|r| r.len() == sent);
                    let Some(results) = results else {
                        let conn = self.db.get()?;
                        outbox::release(&conn, &seqs)?;
                        self.back_off("unexpected answer from the server", true);
                        return Ok(());
                    };
                    self.online.store(true, Ordering::SeqCst);
                    self.gate_fails.store(0, Ordering::SeqCst);
                    self.set_error(None);

                    let mut conn = self.db.get()?;
                    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                    let mut at = 0;
                    for unit in &units {
                        process_unit(&tx, unit, &results[at..at + unit.len()])?;
                        at += unit.len();
                    }
                    tx.commit()?;
                    *self.last_push_at.lock().unwrap() = Some(stamp());
                }
            }
        }
    }

    /// Re-read listed records from the server (after a refusal, or when a
    /// pulled row was held back for queued local work). Best-effort.
    async fn refresh_locked(&self) {
        if self.auth_paused.load(Ordering::SeqCst) || outbox::now_ms() < self.gate_until.load(Ordering::SeqCst) {
            return;
        }
        let list = match self.db.get().map_err(AppError::from).and_then(|c| Ok(outbox::refresh_list(&c, 300)?)) {
            Ok(l) => l,
            Err(_) => return,
        };
        for (entity, id) in list {
            let Ok(conn) = self.db.get() else { return };
            if schema::meta(&entity).is_none() {
                let _ = outbox::refresh_done(&conn, &entity, &id);
                continue;
            }
            if outbox::has_local_intent(&conn, &entity, &id).unwrap_or(true) {
                continue; // its queued work goes first; next time
            }
            drop(conn);
            match self.http.maint_get_raw(&format!("/records/{entity}/{id}")).await {
                Ok(raw) => {
                    let row = serde_json::from_str::<Value>(&raw.body).ok().and_then(|v| v.get("row").cloned());
                    let Ok(conn) = self.db.get() else { return };
                    if let Some(row) = row.filter(Value::is_object) {
                        if outbox::has_local_intent(&conn, &entity, &id).unwrap_or(true) {
                            continue;
                        }
                        if let Err(e) = apply_server_row(&conn, &entity, &row) {
                            tracing::warn!(error = %e, %entity, %id, "refresh: could not apply the server row");
                        }
                    }
                    let _ = outbox::refresh_done(&conn, &entity, &id);
                }
                // The server never had it: the local record was a phantom.
                Err(AppError::Status { status: 404, .. }) => {
                    let Ok(conn) = self.db.get() else { return };
                    let _ = conn.execute(&format!("DELETE FROM {entity} WHERE {} = ?1", pk_for(&entity)), params![id]);
                    let _ = outbox::refresh_done(&conn, &entity, &id);
                }
                Err(AppError::Status { status: 400, .. }) => {
                    let Ok(conn) = self.db.get() else { return };
                    let _ = outbox::refresh_done(&conn, &entity, &id);
                }
                Err(e) => {
                    self.request_failed(&e);
                    return;
                }
            }
        }
    }

    /// Pull every entity stream.
    pub async fn pull(&self) -> AppResult<PullSummary> {
        let _guard = self.drain_lock.lock().await;
        let s = self.pull_locked(false).await?;
        self.refresh_locked().await;
        Ok(s)
    }

    /// Start every stream from zero, then drop local rows the server does not
    /// have. Queued local work is sent first and is never dropped.
    pub async fn resync(&self) -> AppResult<PullSummary> {
        let _guard = self.drain_lock.lock().await;
        self.drain_locked().await?;
        {
            let conn = self.db.get()?;
            conn.execute("DELETE FROM sync_state", [])?;
        }
        let s = self.pull_locked(true).await?;
        self.refresh_locked().await;
        Ok(s)
    }

    async fn pull_locked(&self, full: bool) -> AppResult<PullSummary> {
        let mut summary = PullSummary::default();
        if self.auth_paused.load(Ordering::SeqCst) {
            return Ok(summary);
        }
        let mut failed = false;

        'entities: for meta in schema::ENTITIES {
            let entity = meta.entity;
            let pk = meta.pk;
            let (mut since, mut after_id): (String, Option<String>) = {
                let conn = self.db.get()?;
                conn.query_row(
                    "SELECT since, after_id FROM sync_state WHERE entity_type = ?1",
                    params![entity],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap_or(("1970-01-01T00:00:00Z".to_string(), None))
            };
            let mut seen: HashSet<String> = HashSet::new();

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
                    Err(e) => {
                        summary.errors.push(format!("{entity}: {e}"));
                        self.request_failed(&e);
                        failed = true;
                        break 'entities;
                    }
                };
                // Not our envelope: nothing was pulled, and we are not online.
                let body = serde_json::from_str::<Value>(&raw.body).ok().filter(|v| v.get("rows").map(Value::is_array).unwrap_or(false));
                let Some(body) = body else {
                    summary.errors.push(format!("{entity}: unexpected answer"));
                    self.back_off("unexpected answer from the server", true);
                    failed = true;
                    break 'entities;
                };
                let rows = body.get("rows").and_then(Value::as_array).cloned().unwrap_or_default();
                let has_more = body.get("has_more").and_then(Value::as_bool).unwrap_or(false);

                {
                    let mut conn = self.db.get()?;
                    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                    for row in &rows {
                        let id = match row.get(pk) {
                            Some(Value::String(s)) => s.clone(),
                            Some(other) if !other.is_null() => other.to_string(),
                            _ => continue,
                        };
                        seen.insert(id.clone());
                        if outbox::has_local_intent(&tx, entity, &id)? {
                            // Do not overwrite queued work; re-read it once
                            // that work has gone through.
                            outbox::want_refresh(&tx, entity, &id)?;
                            summary.held_for_local_work += 1;
                            continue;
                        }
                        match apply_server_row(&tx, entity, row) {
                            Ok(()) => summary.applied += 1,
                            // One bad row must not stop the stream.
                            Err(e) => {
                                tracing::error!(error = %e, %entity, %id, "pull: could not apply a row");
                                summary.errors.push(format!("{entity} {id}: {e}"));
                            }
                        }
                    }
                    if let Some(nc) = body.get("next_cursor").and_then(Value::as_str) {
                        since = nc.to_string();
                        after_id = body.get("next_cursor_id").and_then(Value::as_str).map(str::to_string);
                        tx.execute(
                            "INSERT INTO sync_state (entity_type, since, after_id, last_pulled_at)
                             VALUES (?1, ?2, ?3, ?4)
                             ON CONFLICT(entity_type) DO UPDATE SET
                               since = excluded.since, after_id = excluded.after_id,
                               last_pulled_at = excluded.last_pulled_at",
                            params![entity, since, after_id, stamp()],
                        )?;
                    }
                    tx.commit()?;
                }
                if !has_more {
                    break;
                }
            }

            if full {
                // Everything the server has for this entity went past. A local
                // row it never mentioned, with nothing queued for it, is a
                // leftover (a refused change from an older build, or a server
                // that was reset).
                let conn = self.db.get()?;
                let local: Vec<String> = {
                    let mut stmt = conn.prepare(&format!("SELECT CAST({pk} AS TEXT) FROM {entity}"))?;
                    let v = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
                    v
                };
                for id in local.into_iter().filter(|id| !seen.contains(id)) {
                    if !outbox::has_local_intent(&conn, entity, &id)? {
                        conn.execute(&format!("DELETE FROM {entity} WHERE {pk} = ?1"), params![id])?;
                        summary.removed += 1;
                    }
                }
            }
        }

        if !failed {
            self.online.store(true, Ordering::SeqCst);
            self.gate_fails.store(0, Ordering::SeqCst);
            *self.last_pull_at.lock().unwrap() = Some(stamp());
        }
        Ok(summary)
    }
}

#[derive(Debug, Default, Clone, Serialize, specta::Type)]
pub struct PullSummary {
    pub applied: i64,
    pub held_for_local_work: i64,
    /// Local rows removed by a full resync because the server has no such row.
    pub removed: i64,
    pub errors: Vec<String>,
}

/// Tiny query-string percent-encoder (only what cursor values need).
fn urlencoding_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::outbox::{enqueue, queued, test_db, NewOp};

    fn put(c: &Connection, entity: &str, id: &str, op: &str, payload: Value, group: Option<&str>, user: i64) -> OutboxItem {
        enqueue(
            c,
            &NewOp { entity_type: entity, entity_id: id, op, payload: &payload, base_sync_version: 1, user_id: user, group_id: group },
        )
        .unwrap();
        queued(c, 1000).unwrap().into_iter().rev().find(|i| i.entity_id == id && i.entity_type == entity).unwrap()
    }
    fn ids(units: &[Vec<OutboxItem>]) -> Vec<Vec<String>> {
        units.iter().map(|u| u.iter().map(|i| i.entity_id.clone()).collect()).collect()
    }
    fn applied(sv: i64) -> Value {
        json!({"status": "applied", "new_sync_version": sv})
    }
    fn err(code: &str) -> Value {
        json!({"status": "error", "code": code, "message": "no"})
    }

    #[test]
    fn groups_stay_whole_and_nothing_overtakes_a_waiting_record() {
        let c = test_db();
        put(&c, "tires", "t1", "insert", json!({"id": "t1"}), Some("g1"), 1);
        put(&c, "tire_assignments", "a1", "insert", json!({"id": "a1", "tire_id": "t1"}), Some("g1"), 1);
        put(&c, "work_orders", "w1", "insert", json!({"id": "w1"}), None, 1);
        // Size 2 fits the group; the next unit would exceed it.
        let u = select_units(queued(&c, 100).unwrap(), Some(1), 0, 2);
        assert_eq!(ids(&u), vec![vec!["t1", "a1"]]);
        // A group larger than the limit still goes out (alone) rather than never.
        let u = select_units(queued(&c, 100).unwrap(), Some(1), 0, 1);
        assert_eq!(ids(&u), vec![vec!["t1", "a1"]]);

        // The tire insert is backing off: its assignment, and a later edit of
        // the tire, must wait behind it; unrelated work still flows.
        c.execute("UPDATE outbox SET next_attempt_at = 999 WHERE entity_id = 't1'", []).unwrap();
        c.execute("UPDATE outbox SET sent = 1 WHERE entity_id = 't1'", []).unwrap();
        put(&c, "tires", "t1", "update", json!({"dot_code": "1"}), None, 1);
        put(&c, "tire_status_events", "e1", "insert", json!({"id": "e1", "tire_id": "t1"}), None, 1);
        let u = select_units(queued(&c, 100).unwrap(), Some(1), 0, 50);
        assert_eq!(ids(&u), vec![vec!["w1"]]);
    }

    #[test]
    fn two_ops_on_one_record_never_share_a_batch() {
        let c = test_db();
        let first = put(&c, "work_orders", "w", "update", json!({"title": "a"}), None, 1);
        outbox::mark_sent(&c, &[first.seq]).unwrap();
        outbox::recover_inflight(&c).unwrap();
        put(&c, "work_orders", "w", "update", json!({"title": "b"}), None, 1);
        let u = select_units(queued(&c, 100).unwrap(), Some(1), 0, 50);
        assert_eq!(u.len(), 1);
        assert_eq!(u[0][0].seq, first.seq);
    }

    #[test]
    fn another_users_work_waits_and_does_not_block_mine() {
        let c = test_db();
        put(&c, "work_orders", "theirs", "insert", json!({"id": "theirs"}), None, 2);
        put(&c, "work_order_tasks", "their-task", "insert", json!({"id": "x", "work_order_id": "theirs"}), None, 2);
        put(&c, "work_orders", "mine", "insert", json!({"id": "mine"}), None, 1);
        let u = select_units(queued(&c, 100).unwrap(), Some(1), 0, 50);
        assert_eq!(ids(&u), vec![vec!["mine"]]);
    }

    fn seed_wo(c: &Connection, id: &str, title: &str, sv: i64) {
        c.execute(
            "INSERT INTO work_orders (id, vehicle_id, status, title, sync_version) VALUES (?1, 1, 'open', ?2, ?3)",
            params![id, title, sv],
        )
        .unwrap();
    }

    #[test]
    fn applied_acks_and_adopts_the_server_version() {
        let c = test_db();
        seed_wo(&c, "w", "t", 1);
        let item = put(&c, "work_orders", "w", "update", json!({"title": "t"}), None, 1);
        let p = process_unit(&c, &[item], &[applied(4)]).unwrap();
        assert_eq!(p.acked, 1);
        assert!(queued(&c, 10).unwrap().is_empty());
        let sv: i64 = c.query_row("SELECT sync_version FROM work_orders WHERE id = 'w'", [], |r| r.get(0)).unwrap();
        assert_eq!(sv, 4);
    }

    #[test]
    fn a_conflict_keeps_both_sides_fields_and_retries() {
        let c = test_db();
        // Local: the user closed the work order. Meanwhile another device
        // changed its title (server is at version 5).
        c.execute(
            "INSERT INTO work_orders (id, vehicle_id, status, title, closed_at, sync_version)
             VALUES ('w', 1, 'closed', 'old title', '2026-11-20T10:00:00Z', 4)",
            [],
        )
        .unwrap();
        let item = put(&c, "work_orders", "w", "update", json!({"status": "closed", "closed_at": "2026-11-20T10:00:00Z"}), None, 1);
        let server = json!({"id": "w", "vehicle_id": 1, "status": "open", "title": "new title", "closed_at": null, "sync_version": 5});
        let p = process_unit(&c, &[item], &[json!({"status": "conflict", "server_row": server})]).unwrap();
        assert_eq!(p.retried, 1);
        let (status, title, sv): (String, String, i64) = c
            .query_row("SELECT status, title, sync_version FROM work_orders WHERE id = 'w'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap();
        assert_eq!((status.as_str(), title.as_str(), sv), ("closed", "new title", 5), "their title, my close");
        let q = queued(&c, 10).unwrap();
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].base_sync_version, 5, "retried on the server's version");
        assert_eq!(q[0].next_attempt_at, 0, "at once");
        assert_eq!(outbox::unseen_issue_count(&c).unwrap(), 0, "a merge is not a problem to report");
    }

    #[test]
    fn a_change_to_a_record_deleted_elsewhere_is_dropped_with_a_note() {
        let c = test_db();
        seed_wo(&c, "w", "t", 2);
        let item = put(&c, "work_orders", "w", "update", json!({"title": "mine"}), None, 1);
        let server = json!({"id": "w", "deleted_at": "2026-11-20T09:00:00Z", "sync_version": 3});
        let p = process_unit(&c, &[item], &[json!({"status": "conflict", "server_row": server})]).unwrap();
        assert_eq!(p.rejected, 1);
        assert!(queued(&c, 10).unwrap().is_empty());
        let issues = outbox::list_issues(&c, 10).unwrap();
        assert_eq!(issues[0].code, "conflict_deleted");
        assert_eq!(outbox::refresh_list(&c, 10).unwrap(), vec![("work_orders".to_string(), "w".to_string())]);
    }

    #[test]
    fn a_refused_mount_undoes_the_whole_action_with_one_note() {
        let c = test_db();
        c.execute("INSERT INTO tires (id, brand, status, origin, sync_version) VALUES ('t', 'B', 'mounted', 'shipment', 1)", []).unwrap();
        c.execute("INSERT INTO tire_assignments (id, tire_id, position_id, vehicle_id, sync_version) VALUES ('a', 't', 'p', 1, 1)", []).unwrap();
        let tire = put(&c, "tires", "t", "insert", json!({"id": "t", "brand": "B"}), Some("g"), 1);
        let asg = put(&c, "tire_assignments", "a", "insert", json!({"id": "a", "tire_id": "t", "position_id": "p"}), Some("g"), 1);
        // A later edit of the tire is queued behind the action.
        outbox::mark_sent(&c, &[tire.seq, asg.seq]).unwrap();
        put(&c, "tires", "t", "update", json!({"dot_code": "2024"}), None, 1);

        let p = process_unit(&c, &[tire, asg], &[err("group_rolled_back"), err("position_occupied")]).unwrap();
        assert_eq!(p.rejected, 2);
        assert!(queued(&c, 10).unwrap().is_empty(), "the edit of a tire the server never took goes too");
        let issues = outbox::list_issues(&c, 10).unwrap();
        assert_eq!(issues.len(), 1, "one note for one action");
        assert_eq!(issues[0].code, "position_occupied");
        assert_eq!(issues[0].entity_type, "tire_assignments");
        let mut refresh = outbox::refresh_list(&c, 10).unwrap();
        refresh.sort();
        assert_eq!(refresh, vec![("tire_assignments".into(), "a".into()), ("tires".into(), "t".into())]);
    }

    #[test]
    fn an_internal_error_retries_the_unit_together_then_gives_up() {
        let c = test_db();
        let a = put(&c, "work_orders", "w", "insert", json!({"id": "w"}), Some("g"), 1);
        let b = put(&c, "work_order_tasks", "t", "insert", json!({"id": "t", "work_order_id": "w"}), Some("g"), 1);
        let p = process_unit(&c, &[a, b], &[err("internal"), err("group_rolled_back")]).unwrap();
        assert_eq!(p.retried, 2);
        let q = queued(&c, 10).unwrap();
        assert_eq!(q.len(), 2);
        assert!(q[0].next_attempt_at > 0 && q[0].next_attempt_at == q[1].next_attempt_at, "both wait the same time");
        assert_eq!(q[0].attempts, 1);

        c.execute("UPDATE outbox SET attempts = ?1 WHERE entity_id = 'w'", params![outbox::K_MAX_RETRIES - 1]).unwrap();
        let q = queued(&c, 10).unwrap();
        let p = process_unit(&c, &q, &[err("internal"), err("group_rolled_back")]).unwrap();
        assert_eq!(p.rejected, 2);
        assert_eq!(outbox::list_issues(&c, 10).unwrap()[0].code, "gave_up");
    }

    #[test]
    fn a_legacy_dead_letter_becomes_a_note_and_stops_blocking() {
        let c = test_db();
        seed_wo(&c, "w", "t", 1);
        let item = put(&c, "work_orders", "w", "update", json!({"title": "x"}), None, 1);
        c.execute("UPDATE outbox SET status = 'dead', last_error = 'conflict: server version is newer' WHERE seq = ?1", params![item.seq]).unwrap();
        for dead in outbox::legacy_dead(&c).unwrap() {
            reject(&c, &dead, "conflict", dead.last_error.as_deref().unwrap_or(""), false).unwrap();
        }
        assert!(outbox::legacy_dead(&c).unwrap().is_empty());
        assert_eq!(outbox::unseen_issue_count(&c).unwrap(), 1);
    }

    #[test]
    fn server_rows_and_patches_land_in_the_local_table() {
        let c = test_db();
        apply_server_row(&c, "work_order_tasks", &json!({"id": "t", "work_order_id": "w", "is_done": true, "done_at": "2026-11-01T00:00:00Z", "sync_version": 3})).unwrap();
        let (done, at): (i64, String) = c.query_row("SELECT is_done, done_at FROM work_order_tasks WHERE id = 't'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((done, at.as_str()), (1, "2026-11-01T00:00:00Z"));
        apply_patch(&c, "work_order_tasks", "t", &json!({"is_done": false, "done_at": null, "sync_version": 99, "nonsense": 1})).unwrap();
        let (done, sv): (i64, i64) = c.query_row("SELECT is_done, sync_version FROM work_order_tasks WHERE id = 't'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((done, sv), (0, 3), "a patch never writes server-owned columns");
    }
}
