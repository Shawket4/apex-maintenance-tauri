//! The durable outbox — the record of local intent that hasn't reached the
//! server yet. Architecture carried over from the Madar POS rust core (the
//! reasoning, not the code): the queue is crash-survivable, FIFO by `seq`,
//! failures are classified into two classes (network failures never consume
//! retry budget), and dead rows are visible and actionable, never silent.
//!
//! Every function takes a `&Connection` so a caller can enqueue INSIDE the
//! same transaction as its local write — the atomicity gap Madar left open
//! (crash between local write and enqueue) is closed by construction here.
//!
//! Coalescing: at most one pending row per (entity_type, entity_id). State
//! sync sends full-row snapshots, so a newer local write REPLACES the pending
//! payload rather than queueing behind it:
//!
//!   pending insert + update  → pending insert with the new payload
//!                              (the server has never seen the row)
//!   pending insert + delete  → drop the outbox row entirely
//!                              (the server never knew the row existed)
//!   pending update + update  → replace payload
//!   pending update + delete  → becomes delete
//!   inflight + anything      → enqueue a NEW pending row; on ack of the
//!                              inflight one its successor is REBASED to the
//!                              server's new sync_version (see `mark_acked`)

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

pub const K_MAX_RETRIES: i64 = 8;
pub const K_BACKOFF_BASE_MS: i64 = 2_000;
pub const K_BACKOFF_CAP_MS: i64 = 5 * 60 * 1_000;
/// Acked rows are kept as a recovery log, then purged.
pub const K_ACKED_RETENTION_MS: i64 = 48 * 60 * 60 * 1_000;

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Exponential backoff with deterministic per-item jitter (Knuth multiplicative
/// hash of the seq — no RNG, so tests and replays are reproducible).
pub fn backoff_ms(attempts: i64, seq: i64) -> i64 {
    let exp = (attempts - 1).clamp(0, 20) as u32;
    let base = K_BACKOFF_BASE_MS.saturating_mul(1_i64 << exp.min(18));
    let jitter = (seq as u64).wrapping_mul(2_654_435_761) % 1_000;
    base.min(K_BACKOFF_CAP_MS) + jitter as i64
}

#[derive(Debug, Clone, Serialize)]
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
    pub server_row: Option<String>,
    pub enqueued_at: String,
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
        server_row: r.get("server_row")?,
        enqueued_at: r.get("enqueued_at")?,
    })
}

/// Enqueue a local write, coalescing against any existing PENDING row for the
/// same entity. Call inside the same transaction as the local table write.
pub fn enqueue(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
    op: &str,
    payload: &serde_json::Value,
    base_sync_version: i64,
    user_id: i64,
) -> rusqlite::Result<()> {
    let pending: Option<(i64, String)> = conn
        .query_row(
            "SELECT seq, op FROM outbox
              WHERE entity_type = ?1 AND entity_id = ?2 AND status = 'pending'",
            params![entity_type, entity_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;

    let payload_text = serde_json::to_string(payload).expect("payload serialises");

    if let Some((seq, prev_op)) = pending {
        match (prev_op.as_str(), op) {
            ("insert", "delete") => {
                // The server never saw this row — retract the intent entirely.
                conn.execute("DELETE FROM outbox WHERE seq = ?1", params![seq])?;
            }
            ("insert", _) => {
                // Still an insert from the server's point of view; newest snapshot wins.
                conn.execute(
                    "UPDATE outbox SET payload = ?2, enqueued_at = ?3, user_id = ?4,
                                       attempts = 0, next_attempt_at = 0, last_error = NULL
                      WHERE seq = ?1",
                    params![seq, payload_text, now_iso(), user_id],
                )?;
            }
            (_, new_op) => {
                conn.execute(
                    "UPDATE outbox SET op = ?2, payload = ?3, enqueued_at = ?4, user_id = ?5,
                                       attempts = 0, next_attempt_at = 0, last_error = NULL
                      WHERE seq = ?1",
                    params![seq, new_op, payload_text, now_iso(), user_id],
                )?;
            }
        }
        return Ok(());
    }

    conn.execute(
        "INSERT INTO outbox (id, entity_type, entity_id, op, payload, base_sync_version,
                             enqueued_at, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            uuid::Uuid::new_v4().to_string(),
            entity_type,
            entity_id,
            op,
            payload_text,
            base_sync_version,
            now_iso(),
            user_id
        ],
    )?;
    Ok(())
}

/// Pending rows whose backoff gate has passed, in FIFO order.
pub fn due_for_sync(conn: &Connection, now_ms: i64, limit: i64) -> rusqlite::Result<Vec<OutboxItem>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM outbox
          WHERE status = 'pending' AND next_attempt_at <= ?1
          ORDER BY seq ASC LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![now_ms, limit], row_to_item)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn mark_inflight(conn: &Connection, seq: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE outbox SET status = 'inflight' WHERE seq = ?1 AND status = 'pending'",
        params![seq],
    )?;
    Ok(())
}

/// Ack: record success, and REBASE any successor pending row for the same
/// entity onto the server's new sync_version — without this, a write enqueued
/// while its predecessor was inflight would push a stale base and bounce as a
/// conflict every time.
pub fn mark_acked(conn: &Connection, seq: i64, new_sync_version: i64) -> rusqlite::Result<()> {
    let (etype, eid): (String, String) = conn.query_row(
        "SELECT entity_type, entity_id FROM outbox WHERE seq = ?1",
        params![seq],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    conn.execute(
        "UPDATE outbox SET status = 'acked', synced_at = ?2 WHERE seq = ?1",
        params![seq, now_ms()],
    )?;
    conn.execute(
        "UPDATE outbox SET base_sync_version = ?3
          WHERE entity_type = ?1 AND entity_id = ?2 AND status = 'pending'",
        params![etype, eid, new_sync_version],
    )?;
    Ok(())
}

/// Counted retry — the request itself failed (server error). Consumes budget.
pub fn mark_retry(conn: &Connection, seq: i64, error: &str, next_attempt_at: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE outbox SET status = 'pending', attempts = attempts + 1,
                           last_error = ?2, next_attempt_at = ?3
          WHERE seq = ?1",
        params![seq, error, next_attempt_at],
    )?;
    Ok(())
}

/// Uncounted retry — the NETWORK failed, not the request. Never consumes
/// budget: without this distinction, eight offline minutes would dead-letter
/// a perfectly good write.
pub fn mark_retry_no_count(conn: &Connection, seq: i64, next_attempt_at: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE outbox SET status = 'pending', next_attempt_at = ?2 WHERE seq = ?1",
        params![seq, next_attempt_at],
    )?;
    Ok(())
}

pub fn mark_dead(
    conn: &Connection,
    seq: i64,
    error: &str,
    server_row: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE outbox SET status = 'dead', last_error = ?2, server_row = ?3 WHERE seq = ?1",
        params![seq, error, server_row],
    )?;
    Ok(())
}

/// Crash recovery: anything stranded inflight goes back to pending. Safe only
/// because the drain is single-flight (engine holds a mutex across the body).
pub fn recover_inflight(conn: &Connection) -> rusqlite::Result<usize> {
    Ok(conn.execute(
        "UPDATE outbox SET status = 'pending' WHERE status = 'inflight'",
        [],
    )?)
}

/// Clear pure-network gates so a confirmed reconnect drains NOW. Leaves real
/// server-error backoff (attempts > 0) untouched.
pub fn clear_network_backoff(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE outbox SET next_attempt_at = 0
          WHERE status = 'pending' AND attempts = 0 AND next_attempt_at > 0",
        [],
    )?;
    Ok(())
}

pub fn requeue_dead(conn: &Connection, seq: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE outbox SET status = 'pending', attempts = 0, next_attempt_at = 0,
                           last_error = NULL, server_row = NULL
          WHERE seq = ?1 AND status = 'dead'",
        params![seq],
    )?;
    Ok(())
}

/// Discard is allowed ONLY for dead rows — a pending/inflight op might still land.
pub fn discard_dead(conn: &Connection, seq: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM outbox WHERE seq = ?1 AND status = 'dead'", params![seq])?;
    Ok(())
}

pub fn purge_acked_older_than(conn: &Connection, cutoff_ms: i64) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM outbox WHERE status = 'acked' AND synced_at < ?1",
        params![cutoff_ms],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct OutboxCounts {
    pub pending: i64,
    pub inflight: i64,
    pub dead: i64,
}

pub fn counts(conn: &Connection) -> rusqlite::Result<OutboxCounts> {
    let one = |st: &str| -> rusqlite::Result<i64> {
        conn.query_row(
            "SELECT COUNT(*) FROM outbox WHERE status = ?1",
            params![st],
            |r| r.get(0),
        )
    };
    Ok(OutboxCounts {
        pending: one("pending")?,
        inflight: one("inflight")?,
        dead: one("dead")?,
    })
}

/// Everything a Diagnostics screen needs: active queue + dead letters.
pub fn list_active(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<OutboxItem>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM outbox WHERE status IN ('pending','inflight','dead')
          ORDER BY CASE status WHEN 'dead' THEN 0 ELSE 1 END, seq ASC
          LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![limit], row_to_item)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Does un-pushed local intent exist for this entity? (Pull guard.)
pub fn has_local_intent(conn: &Connection, entity_type: &str, entity_id: &str) -> rusqlite::Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM outbox
          WHERE entity_type = ?1 AND entity_id = ?2 AND status IN ('pending','inflight')",
        params![entity_type, entity_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../migrations/0001_init_schema.sql")).unwrap();
        conn.execute_batch(include_str!("../migrations/0002_seeds.sql")).unwrap();
        conn.execute_batch(include_str!("../migrations/0003_sync_conflicts.sql")).unwrap();
        conn.execute_batch(include_str!("../migrations/0004_offline_engine.sql")).unwrap();
        conn
    }

    #[test]
    fn enqueue_coalesces_updates_into_pending_insert() {
        let c = mem();
        enqueue(&c, "tires", "t1", "insert", &json!({"v": 1}), 0, 7).unwrap();
        enqueue(&c, "tires", "t1", "update", &json!({"v": 2}), 0, 7).unwrap();
        let due = due_for_sync(&c, now_ms(), 10).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].op, "insert", "server has never seen the row");
        assert!(due[0].payload.contains("\"v\":2"), "newest snapshot wins");
    }

    #[test]
    fn insert_then_delete_retracts_entirely() {
        let c = mem();
        enqueue(&c, "tires", "t1", "insert", &json!({}), 0, 7).unwrap();
        enqueue(&c, "tires", "t1", "delete", &json!({}), 0, 7).unwrap();
        assert_eq!(due_for_sync(&c, now_ms(), 10).unwrap().len(), 0);
    }

    #[test]
    fn update_then_delete_becomes_delete() {
        let c = mem();
        enqueue(&c, "tires", "t1", "update", &json!({"v": 1}), 3, 7).unwrap();
        enqueue(&c, "tires", "t1", "delete", &json!({}), 3, 7).unwrap();
        let due = due_for_sync(&c, now_ms(), 10).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].op, "delete");
        assert_eq!(due[0].base_sync_version, 3, "base survives coalescing");
    }

    #[test]
    fn ack_rebases_successor_pending_row() {
        let c = mem();
        enqueue(&c, "tires", "t1", "update", &json!({"v": 1}), 3, 7).unwrap();
        let seq1 = due_for_sync(&c, now_ms(), 10).unwrap()[0].seq;
        mark_inflight(&c, seq1).unwrap();
        // A second write lands while the first is inflight → new pending row.
        enqueue(&c, "tires", "t1", "update", &json!({"v": 2}), 3, 7).unwrap();
        // Server acks the first at version 4; the successor must rebase to 4
        // or it would bounce off the server as a stale-version conflict.
        mark_acked(&c, seq1, 4).unwrap();
        let due = due_for_sync(&c, now_ms(), 10).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].base_sync_version, 4);
    }

    #[test]
    fn two_class_retry_only_counts_request_failures() {
        let c = mem();
        enqueue(&c, "tires", "t1", "update", &json!({}), 1, 7).unwrap();
        let seq = due_for_sync(&c, now_ms(), 10).unwrap()[0].seq;

        mark_inflight(&c, seq).unwrap();
        mark_retry_no_count(&c, seq, now_ms() - 1).unwrap(); // network blip
        let item = &due_for_sync(&c, now_ms(), 10).unwrap()[0];
        assert_eq!(item.attempts, 0, "offline must not burn retry budget");

        mark_inflight(&c, seq).unwrap();
        mark_retry(&c, seq, "500", now_ms() - 1).unwrap(); // server error
        let item = &due_for_sync(&c, now_ms(), 10).unwrap()[0];
        assert_eq!(item.attempts, 1);
    }

    #[test]
    fn backoff_grows_and_caps_deterministically() {
        assert!(backoff_ms(1, 5) < backoff_ms(3, 5));
        assert!(backoff_ms(20, 5) <= K_BACKOFF_CAP_MS + 999);
        assert_eq!(backoff_ms(4, 9), backoff_ms(4, 9), "no RNG");
    }

    #[test]
    fn discard_refuses_non_dead_rows() {
        let c = mem();
        enqueue(&c, "tires", "t1", "update", &json!({}), 1, 7).unwrap();
        let seq = due_for_sync(&c, now_ms(), 10).unwrap()[0].seq;
        discard_dead(&c, seq).unwrap(); // no-op: row is pending
        assert_eq!(due_for_sync(&c, now_ms(), 10).unwrap().len(), 1);
        mark_dead(&c, seq, "x", None).unwrap();
        discard_dead(&c, seq).unwrap();
        assert_eq!(counts(&c).unwrap().dead, 0);
    }

    #[test]
    fn recover_inflight_returns_stranded_rows_to_pending() {
        let c = mem();
        enqueue(&c, "tires", "t1", "update", &json!({}), 1, 7).unwrap();
        let seq = due_for_sync(&c, now_ms(), 10).unwrap()[0].seq;
        mark_inflight(&c, seq).unwrap();
        assert_eq!(due_for_sync(&c, now_ms(), 10).unwrap().len(), 0);
        assert_eq!(recover_inflight(&c).unwrap(), 1);
        assert_eq!(due_for_sync(&c, now_ms(), 10).unwrap().len(), 1);
    }
}
