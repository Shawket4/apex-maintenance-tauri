//! The durable outbox — local intent the server has not confirmed yet.
//!
//! Rules (v2, see migration 0011):
//!
//! * One row = one op, sent to the server with `id` as its `op_id`. The server
//!   remembers applied op ids, so sending a row twice is harmless.
//! * A row that has been SENT (`sent = 1`) is frozen. A later edit of the same
//!   record queues a new row behind it. Only a row that never left the device
//!   may absorb a newer edit — folding into a sent row is how edits used to
//!   disappear when an ack was lost.
//! * Rows written in one local transaction for one user action share a
//!   `group_id`; the server applies a group all-or-nothing.
//! * Insert payloads are the row; update payloads carry ONLY the columns the
//!   user changed, so a retry after another device's edit cannot revert that
//!   device's fields.
//! * There is no permanent "dead" state. An op the server refuses is removed,
//!   its local effect undone (engine), and a `sync_issues` row tells the user.
//!
//! Every function takes a `&Connection` so a caller enqueues inside the same
//! transaction as its local write.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

/// Counted attempts before an op that keeps failing on its own is given up.
pub const K_MAX_RETRIES: i64 = 6;
pub const K_BACKOFF_BASE_MS: i64 = 2_000;
pub const K_BACKOFF_CAP_MS: i64 = 5 * 60 * 1_000;
/// Acked rows are kept briefly as a recovery log, then purged.
pub const K_ACKED_RETENTION_MS: i64 = 48 * 60 * 60 * 1_000;

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Exponential backoff with deterministic per-item jitter.
pub fn backoff_ms(attempts: i64, seq: i64) -> i64 {
    let exp = (attempts - 1).clamp(0, 20) as u32;
    let base = K_BACKOFF_BASE_MS.saturating_mul(1_i64 << exp.min(18));
    let jitter = (seq as u64).wrapping_mul(2_654_435_761) % 1_000;
    base.min(K_BACKOFF_CAP_MS) + jitter as i64
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct OutboxItem {
    pub seq: i64,
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub op: String,
    pub payload: String,
    pub base_sync_version: i64,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub enqueued_at: String,
    pub group_id: Option<String>,
    pub sent: bool,
    pub next_attempt_at: i64,
    pub user_id: Option<i64>,
}

fn row_to_item(r: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxItem> {
    Ok(OutboxItem {
        seq: r.get("seq")?,
        id: r.get("id")?,
        entity_type: r.get("entity_type")?,
        entity_id: r.get("entity_id")?,
        op: r.get("op")?,
        payload: r.get("payload")?,
        base_sync_version: r.get("base_sync_version")?,
        status: r.get("status")?,
        attempts: r.get("attempts")?,
        last_error: r.get("last_error")?,
        enqueued_at: r.get("enqueued_at")?,
        group_id: r.get("group_id")?,
        sent: r.get::<_, i64>("sent")? != 0,
        next_attempt_at: r.get("next_attempt_at")?,
        user_id: r.get("user_id")?,
    })
}

/// One queued write.
pub struct NewOp<'a> {
    pub entity_type: &'a str,
    pub entity_id: &'a str,
    /// insert | update | delete
    pub op: &'a str,
    /// insert: the row. update: only the changed columns. delete: `{}`.
    pub payload: &'a Value,
    pub base_sync_version: i64,
    pub user_id: i64,
    pub group_id: Option<&'a str>,
}

/// What `enqueue` did — the caller of a delete needs to know when the server
/// never saw the row at all.
#[derive(Debug, PartialEq, Eq)]
pub enum Enqueued {
    /// A new row was queued.
    Queued,
    /// Merged into a row that had not been sent yet.
    Merged,
    /// insert + delete, both unsent: the server never knew the record.
    Cancelled,
}

fn merge_objects(base: &str, patch: &Value) -> String {
    let mut merged: Value = serde_json::from_str(base).unwrap_or_else(|_| Value::Object(Default::default()));
    if let (Some(m), Some(p)) = (merged.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            m.insert(k.clone(), v.clone());
        }
    }
    merged.to_string()
}

/// Queue a write. Merges only into the LAST queued row for the same record,
/// and only when that row has never been sent.
pub fn enqueue(conn: &Connection, new: &NewOp<'_>) -> rusqlite::Result<Enqueued> {
    let last: Option<(i64, String, String, i64)> = conn
        .query_row(
            "SELECT seq, op, payload, sent FROM outbox
              WHERE entity_type = ?1 AND entity_id = ?2 AND status IN ('pending','inflight')
              ORDER BY seq DESC LIMIT 1",
            params![new.entity_type, new.entity_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;

    if let Some((seq, prev_op, prev_payload, sent)) = last {
        if sent == 0 {
            match (prev_op.as_str(), new.op) {
                ("insert", "delete") => {
                    conn.execute("DELETE FROM outbox WHERE seq = ?1", params![seq])?;
                    return Ok(Enqueued::Cancelled);
                }
                ("insert", "update") | ("update", "update") | ("insert", "insert") => {
                    conn.execute(
                        "UPDATE outbox SET payload = ?2 WHERE seq = ?1",
                        params![seq, merge_objects(&prev_payload, new.payload)],
                    )?;
                    return Ok(Enqueued::Merged);
                }
                ("update", "delete") => {
                    conn.execute(
                        "UPDATE outbox SET op = 'delete', payload = '{}' WHERE seq = ?1",
                        params![seq],
                    )?;
                    return Ok(Enqueued::Merged);
                }
                // delete followed by anything, or an update followed by an
                // insert (a singleton re-created): queue behind it.
                _ => {}
            }
        }
    }

    conn.execute(
        "INSERT INTO outbox (id, entity_type, entity_id, op, payload, base_sync_version,
                             enqueued_at, user_id, group_id, sent)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)",
        params![
            uuid::Uuid::new_v4().to_string(),
            new.entity_type,
            new.entity_id,
            new.op,
            new.payload.to_string(),
            new.base_sync_version,
            now_iso(),
            new.user_id,
            new.group_id,
        ],
    )?;
    Ok(Enqueued::Queued)
}

/// Every unconfirmed row in FIFO order (capped). The engine builds batches
/// from this — it needs the not-yet-due rows too, to keep later ops on the
/// same record from overtaking them.
pub fn queued(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<OutboxItem>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM outbox WHERE status IN ('pending','inflight') ORDER BY seq ASC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], row_to_item)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Mark rows as handed to the network. From here on they are frozen.
pub fn mark_sent(conn: &Connection, seqs: &[i64]) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare("UPDATE outbox SET status = 'inflight', sent = 1 WHERE seq = ?1")?;
    for s in seqs {
        stmt.execute(params![s])?;
    }
    Ok(())
}

/// Ack: the server applied the op at `new_sync_version`. Later rows for the
/// same record are based on that version from now on.
pub fn mark_acked(conn: &Connection, item: &OutboxItem, new_sync_version: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE outbox SET status = 'acked', synced_at = ?2, last_error = NULL WHERE seq = ?1",
        params![item.seq, now_ms()],
    )?;
    rebase(conn, &item.entity_type, &item.entity_id, new_sync_version)
}

/// Point every still-queued row for a record at a server version.
pub fn rebase(conn: &Connection, entity_type: &str, entity_id: &str, sync_version: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE outbox SET base_sync_version = ?3
          WHERE entity_type = ?1 AND entity_id = ?2 AND status IN ('pending','inflight') AND op <> 'insert'",
        params![entity_type, entity_id, sync_version],
    )?;
    Ok(())
}

/// Back to the queue without consuming retry budget (network, server busy).
pub fn release(conn: &Connection, seqs: &[i64]) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare("UPDATE outbox SET status = 'pending' WHERE seq = ?1 AND status = 'inflight'")?;
    for s in seqs {
        stmt.execute(params![s])?;
    }
    Ok(())
}

/// Back to the queue, counted, with a backoff gate — the op itself failed.
pub fn retry_later(conn: &Connection, seq: i64, error: &str, next_attempt_at: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE outbox SET status = 'pending', attempts = attempts + 1, last_error = ?2, next_attempt_at = ?3
          WHERE seq = ?1",
        params![seq, error, next_attempt_at],
    )?;
    Ok(())
}

/// Remove a row for good (refused by the server, or superseded).
pub fn remove(conn: &Connection, seq: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM outbox WHERE seq = ?1", params![seq])?;
    Ok(())
}

/// Remove every queued row for one record; returns how many.
pub fn remove_for_entity(conn: &Connection, entity_type: &str, entity_id: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM outbox WHERE entity_type = ?1 AND entity_id = ?2 AND status IN ('pending','inflight','dead')",
        params![entity_type, entity_id],
    )
}

/// Crash recovery: anything stranded mid-request goes back to the queue. It
/// keeps `sent = 1`, so it is re-sent as the same op and never rewritten.
pub fn recover_inflight(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute("UPDATE outbox SET status = 'pending' WHERE status = 'inflight'", [])
}

pub fn purge_acked_older_than(conn: &Connection, cutoff_ms: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM outbox WHERE status = 'acked' AND synced_at < ?1", params![cutoff_ms])?;
    Ok(())
}

/// Rows a pre-v2 build left in its permanent "dead" state.
pub fn legacy_dead(conn: &Connection) -> rusqlite::Result<Vec<OutboxItem>> {
    let mut stmt = conn.prepare("SELECT * FROM outbox WHERE status = 'dead' ORDER BY seq ASC")?;
    let rows = stmt.query_map([], row_to_item)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[derive(Debug, Clone, Serialize)]
pub struct OutboxCounts {
    /// Waiting to be sent (includes rows mid-request).
    pub pending: i64,
    /// Queued by a different user than the one signed in.
    pub other_user: i64,
}

pub fn counts(conn: &Connection, current_user: Option<i64>) -> rusqlite::Result<OutboxCounts> {
    let pending: i64 =
        conn.query_row("SELECT COUNT(*) FROM outbox WHERE status IN ('pending','inflight')", [], |r| r.get(0))?;
    let other_user: i64 = match current_user {
        Some(uid) => conn.query_row(
            "SELECT COUNT(*) FROM outbox WHERE status IN ('pending','inflight') AND user_id IS NOT NULL AND user_id <> ?1",
            params![uid],
            |r| r.get(0),
        )?,
        None => 0,
    };
    Ok(OutboxCounts { pending, other_user })
}

/// Is there queued local work for this record?
pub fn has_local_intent(conn: &Connection, entity_type: &str, entity_id: &str) -> rusqlite::Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM outbox
          WHERE entity_type = ?1 AND entity_id = ?2 AND status IN ('pending','inflight')",
        params![entity_type, entity_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// Queued update payloads for a record, oldest first — re-applied on top of a
/// server row when a conflict is merged.
pub fn queued_update_payloads(conn: &Connection, entity_type: &str, entity_id: &str) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT payload FROM outbox
          WHERE entity_type = ?1 AND entity_id = ?2 AND status IN ('pending','inflight') AND op = 'update'
          ORDER BY seq ASC",
    )?;
    let rows = stmt
        .query_map(params![entity_type, entity_id], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows.into_iter().filter_map(|p| serde_json::from_str(&p).ok()).collect())
}

// ── issues: what the user is told when a change did not stick ────────────────

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct SyncIssue {
    pub id: i64,
    pub created_at: String,
    pub entity_type: String,
    pub entity_id: String,
    pub op: String,
    /// Stable code (server rule code, or `conflict_deleted`, `gave_up`).
    pub code: String,
    pub message: Option<String>,
    /// JSON of what the user had entered.
    pub detail: Option<String>,
    pub seen: bool,
}

pub fn add_issue(conn: &Connection, item: &OutboxItem, code: &str, message: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO sync_issues (created_at, entity_type, entity_id, op, code, message, detail, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![now_iso(), item.entity_type, item.entity_id, item.op, code, message, item.payload, item.user_id],
    )?;
    Ok(())
}

pub fn list_issues(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<SyncIssue>> {
    let mut stmt = conn.prepare(
        "SELECT id, created_at, entity_type, entity_id, op, code, message, detail, seen
           FROM sync_issues ORDER BY seen ASC, id DESC LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![limit], |r| {
            Ok(SyncIssue {
                id: r.get(0)?,
                created_at: r.get(1)?,
                entity_type: r.get(2)?,
                entity_id: r.get(3)?,
                op: r.get(4)?,
                code: r.get(5)?,
                message: r.get(6)?,
                detail: r.get(7)?,
                seen: r.get::<_, i64>(8)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn unseen_issue_count(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM sync_issues WHERE seen = 0", [], |r| r.get(0))
}

pub fn mark_issues_seen(conn: &Connection, id: Option<i64>) -> rusqlite::Result<()> {
    match id {
        Some(id) => conn.execute("UPDATE sync_issues SET seen = 1 WHERE id = ?1", params![id])?,
        None => conn.execute("UPDATE sync_issues SET seen = 1", [])?,
    };
    conn.execute("DELETE FROM sync_issues WHERE seen = 1 AND id NOT IN (SELECT id FROM sync_issues ORDER BY id DESC LIMIT 200)", [])?;
    Ok(())
}

// ── refresh list: records to re-read from the server ─────────────────────────

pub fn want_refresh(conn: &Connection, entity_type: &str, entity_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO sync_refresh (entity_type, entity_id) VALUES (?1, ?2)",
        params![entity_type, entity_id],
    )?;
    Ok(())
}

pub fn refresh_list(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT entity_type, entity_id FROM sync_refresh LIMIT ?1")?;
    let rows = stmt.query_map(params![limit], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn refresh_done(conn: &Connection, entity_type: &str, entity_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM sync_refresh WHERE entity_type = ?1 AND entity_id = ?2",
        params![entity_type, entity_id],
    )?;
    Ok(())
}

#[cfg(test)]
pub(crate) fn test_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    for sql in [
        include_str!("../migrations/0001_init_schema.sql"),
        include_str!("../migrations/0002_seeds.sql"),
        include_str!("../migrations/0003_sync_conflicts.sql"),
        include_str!("../migrations/0004_offline_engine.sql"),
        include_str!("../migrations/0005_new_domain.sql"),
        include_str!("../migrations/0006_reference_stock.sql"),
        include_str!("../migrations/0007_dismount_wo.sql"),
        include_str!("../migrations/0008_override_semantics.sql"),
        include_str!("../migrations/0009_integrity.sql"),
        include_str!("../migrations/0010_stock_movements_cache.sql"),
        include_str!("../migrations/0011_sync_v2.sql"),
        include_str!("../migrations/0012_catalogs.sql"),
        include_str!("../migrations/0013_stock_counts.sql"),
    ] {
        conn.execute_batch(sql).unwrap();
    }
    conn
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn op<'a>(id: &'a str, op: &'a str, payload: &'a Value, group: Option<&'a str>) -> NewOp<'a> {
        NewOp { entity_type: "work_order_tasks", entity_id: id, op, payload, base_sync_version: 1, user_id: 7, group_id: group }
    }

    #[test]
    fn unsent_rows_absorb_edits_and_sent_rows_never_do() {
        let c = test_db();
        let ins = json!({"id": "t1", "is_done": false, "description_ar": "x"});
        assert_eq!(enqueue(&c, &op("t1", "insert", &ins, None)).unwrap(), Enqueued::Queued);
        // Not sent yet: the tick folds into the insert.
        assert_eq!(enqueue(&c, &op("t1", "update", &json!({"is_done": true}), None)).unwrap(), Enqueued::Merged);
        let q = queued(&c, 10).unwrap();
        assert_eq!(q.len(), 1);
        let p: Value = serde_json::from_str(&q[0].payload).unwrap();
        assert_eq!(p["is_done"], json!(true));
        assert_eq!(p["description_ar"], json!("x"));
        assert_eq!(q[0].op, "insert");

        // Sent: the next edit must queue behind it, with its own id.
        mark_sent(&c, &[q[0].seq]).unwrap();
        assert_eq!(enqueue(&c, &op("t1", "update", &json!({"is_done": false}), None)).unwrap(), Enqueued::Queued);
        let q = queued(&c, 10).unwrap();
        assert_eq!(q.len(), 2);
        let first: Value = serde_json::from_str(&q[0].payload).unwrap();
        assert_eq!(first["is_done"], json!(true), "the sent payload is untouched");
        assert_ne!(q[0].id, q[1].id);

        // A further edit folds into the unsent tail, not the sent head.
        enqueue(&c, &op("t1", "update", &json!({"description_ar": "y"}), None)).unwrap();
        let q = queued(&c, 10).unwrap();
        assert_eq!(q.len(), 2);
        let tail: Value = serde_json::from_str(&q[1].payload).unwrap();
        assert_eq!(tail, json!({"is_done": false, "description_ar": "y"}));
    }

    #[test]
    fn insert_then_delete_before_sending_cancels_out_but_not_after() {
        let c = test_db();
        enqueue(&c, &op("a", "insert", &json!({"id": "a"}), None)).unwrap();
        assert_eq!(enqueue(&c, &op("a", "delete", &json!({}), None)).unwrap(), Enqueued::Cancelled);
        assert!(queued(&c, 10).unwrap().is_empty());

        enqueue(&c, &op("b", "insert", &json!({"id": "b"}), None)).unwrap();
        let seq = queued(&c, 10).unwrap()[0].seq;
        mark_sent(&c, &[seq]).unwrap();
        assert_eq!(enqueue(&c, &op("b", "delete", &json!({}), None)).unwrap(), Enqueued::Queued);
        assert_eq!(queued(&c, 10).unwrap().len(), 2, "the server may hold the row: the delete must be sent");
    }

    #[test]
    fn ack_rebases_the_rows_behind_it() {
        let c = test_db();
        enqueue(&c, &op("t", "update", &json!({"is_done": true}), None)).unwrap();
        let head = queued(&c, 10).unwrap().remove(0);
        mark_sent(&c, &[head.seq]).unwrap();
        enqueue(&c, &op("t", "update", &json!({"is_done": false}), None)).unwrap();
        mark_acked(&c, &head, 5).unwrap();
        let q = queued(&c, 10).unwrap();
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].base_sync_version, 5);
    }

    #[test]
    fn crash_recovery_keeps_sent_rows_frozen() {
        let c = test_db();
        enqueue(&c, &op("t", "insert", &json!({"id": "t", "is_done": false}), None)).unwrap();
        let seq = queued(&c, 10).unwrap()[0].seq;
        mark_sent(&c, &[seq]).unwrap();
        recover_inflight(&c).unwrap();
        let q = queued(&c, 10).unwrap();
        assert_eq!(q[0].status, "pending");
        assert!(q[0].sent);
        assert_eq!(enqueue(&c, &op("t", "update", &json!({"is_done": true}), None)).unwrap(), Enqueued::Queued);
    }

    #[test]
    fn counts_separate_another_users_work() {
        let c = test_db();
        enqueue(&c, &op("t", "insert", &json!({"id": "t"}), None)).unwrap();
        assert_eq!(counts(&c, Some(7)).unwrap().other_user, 0);
        let k = counts(&c, Some(8)).unwrap();
        assert_eq!((k.pending, k.other_user), (1, 1));
    }

    #[test]
    fn backoff_grows_and_is_capped() {
        assert!(backoff_ms(1, 1) < backoff_ms(4, 1));
        assert!(backoff_ms(30, 1) <= K_BACKOFF_CAP_MS + 1_000);
    }
}
