//! Owned-domain WRITES against the LOCAL database.
//!
//! Every write is one SQLite transaction that (a) applies the change to the
//! local table and (b) enqueues the same row in the outbox. Reads live in
//! services/views.rs — the local database IS the working truth; the outbox is
//! the record of what the server hasn't confirmed yet.
//!
//! Nothing here talks to the network. The engine drains the outbox; the
//! commands layer kicks it after each write.
//!
//! Server-derived projections (the rule, mirrored from maint-rust
//! services/side_effects.rs): `tires.status` and `tires.total_km` are derived
//! from assignment events, and stock debits are derived from oil-change /
//! shipment-tire inserts. The client applies the SAME derivations locally for
//! immediate UX but NEVER enqueues them — pushing a competing `tires` update
//! would race the server's own sync_version bump and dead-letter a legitimate
//! write. The next /sync/pull confirms the server's copy of the derivation.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::DbPool;
use crate::services::outbox;
use crate::{AppError, AppResult};

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// The 34–36 L band, client copy. MUST match maint-rust
/// side_effects::{OIL_FLAG_MIN, OIL_FLAG_MAX} — the server recomputes the
/// flag authoritatively on apply; this copy exists for immediate local UX.
pub const OIL_FLAG_MIN: f64 = 34.0;
pub const OIL_FLAG_MAX: f64 = 36.0;

pub fn oil_flagged(liters: f64) -> bool {
    !(OIL_FLAG_MIN..=OIL_FLAG_MAX).contains(&liters)
}

/// Dismount reason → tire status. MUST match maint-rust side_effects::dismount_status.
pub fn dismount_status(reason: &str) -> &'static str {
    match reason {
        "worn" | "damaged" => "scrapped",
        "retread" => "retreading",
        "puncture" => "in_repair",
        _ => "in_stock_used",
    }
}

/// Read a full row back as JSON (the outbox payload is always the row snapshot).
fn row_snapshot(conn: &Connection, table: &str, pk: &str, id: &str) -> AppResult<Value> {
    let cols = crate::services::schema::columns_for(table);
    let sql = format!("SELECT {} FROM {table} WHERE {pk} = ?1", cols.join(", "));
    let mut stmt = conn.prepare(&sql)?;
    let v = stmt
        .query_row(params![id], |r| {
            let mut obj = serde_json::Map::new();
            for (i, c) in cols.iter().enumerate() {
                let val = match r.get_ref(i)? {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(n) => json!(n),
                    rusqlite::types::ValueRef::Real(f) => json!(f),
                    rusqlite::types::ValueRef::Text(t) => {
                        Value::String(String::from_utf8_lossy(t).to_string())
                    }
                    rusqlite::types::ValueRef::Blob(_) => Value::Null,
                };
                obj.insert((*c).to_string(), val);
            }
            Ok(Value::Object(obj))
        })
        .optional()?;
    v.ok_or_else(|| AppError::Internal(format!("{table} row {id} vanished mid-transaction")))
}

/// Booleans arrive as SQLite 0/1 integers in snapshots; the server expects real
/// JSON booleans for boolean-typed columns. The column lists live in the
/// schema registry — one edit per new boolean column, not four.
fn fix_bools(entity: &str, mut row: Value) -> Value {
    let bool_cols: &[&str] =
        crate::services::schema::meta(entity).map(|m| m.bool_cols).unwrap_or(&[]);
    if let Value::Object(map) = &mut row {
        for c in bool_cols {
            if let Some(Value::Number(n)) = map.get(*c) {
                let b = n.as_i64().unwrap_or(0) != 0;
                map.insert((*c).to_string(), Value::Bool(b));
            }
        }
    }
    row
}

/// The shared write path: local write already executed on `tx`; snapshot the
/// row and enqueue it.
fn enqueue_row(tx: &Connection, entity: &str, id: &str, op: &str, user_id: i64) -> AppResult<()> {
    let pk = crate::services::schema::pk_for(entity);
    let snapshot = fix_bools(entity, row_snapshot(tx, entity, pk, id)?);
    let base_sv = snapshot.get("sync_version").and_then(|v| v.as_i64()).unwrap_or(1);
    // For inserts the server accepts any version; for updates the base is the
    // last server-acked version, which is exactly what the local row carries.
    outbox::enqueue(tx, entity, id, op, &snapshot, if op == "insert" { 0 } else { base_sv }, user_id)?;
    Ok(())
}

// ═════════════════════════════ work orders ═══════════════════════════════════

pub fn wo_open(
    pool: &DbPool,
    vehicle_id: i64,
    odometer_at_open: Option<i64>,
    user_id: i64,
) -> AppResult<String> {
    let id = Uuid::new_v4().to_string();
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();
    tx.execute(
        "INSERT INTO work_orders
           (id, vehicle_id, status, title, odometer_at_open, opened_at,
            created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,'open',NULL,?3,?4,?4,?4,?5,?5,1)",
        params![id, vehicle_id, odometer_at_open, now, user_id],
    )?;
    enqueue_row(&tx, "work_orders", &id, "insert", user_id)?;
    tx.commit()?;
    Ok(id)
}

pub fn wo_close(pool: &DbPool, id: &str, user_id: i64) -> AppResult<()> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();
    let n = tx.execute(
        "UPDATE work_orders SET status='closed', closed_at=?2, updated_at=?2, updated_by_user_id=?3
          WHERE id=?1 AND status='open' AND deleted_at IS NULL",
        params![id, now, user_id],
    )?;
    if n == 0 {
        return Err(AppError::Internal("open work order not found".into()));
    }
    enqueue_row(&tx, "work_orders", id, "update", user_id)?;
    tx.commit()?;
    Ok(())
}

/// Escape hatch for a WO closed by mistake — the inverse of wo_close.
pub fn wo_reopen(pool: &DbPool, id: &str, user_id: i64) -> AppResult<()> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let n = tx.execute(
        "UPDATE work_orders SET status='open', closed_at=NULL, updated_at=?2, updated_by_user_id=?3
          WHERE id=?1 AND status='closed' AND deleted_at IS NULL",
        params![id, now_iso(), user_id],
    )?;
    if n == 0 {
        return Err(AppError::Internal("closed work order not found".into()));
    }
    enqueue_row(&tx, "work_orders", id, "update", user_id)?;
    tx.commit()?;
    Ok(())
}

/// Correct odometer_at_open on an existing WO. It is both an odometer-truth
/// candidate AND the due baseline last_km — a fat-fingered digit used to skew
/// next_due_km for every category done under that WO, permanently.
pub fn wo_set_odometer(
    pool: &DbPool,
    id: &str,
    odometer_at_open: Option<i64>,
    user_id: i64,
) -> AppResult<()> {
    if let Some(km) = odometer_at_open {
        if km < 0 {
            return Err(AppError::Internal("odometer must be >= 0".into()));
        }
    }
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let n = tx.execute(
        "UPDATE work_orders SET odometer_at_open=?2, updated_at=?3, updated_by_user_id=?4
          WHERE id=?1 AND deleted_at IS NULL",
        params![id, odometer_at_open, now_iso(), user_id],
    )?;
    if n == 0 {
        return Err(AppError::Internal("work order not found".into()));
    }
    enqueue_row(&tx, "work_orders", id, "update", user_id)?;
    tx.commit()?;
    Ok(())
}

/// Seed a historical "last done" baseline without faking today's date: a
/// CLOSED work order stamped with the real performed_at + odometer and one
/// DONE task of the category. Without this, configuring plans floods every
/// truck with never_done and the only workaround was fake WOs dated today —
/// which restarts time-based plans from today.
pub fn record_baseline(
    pool: &DbPool,
    vehicle_id: i64,
    category_id: &str,
    performed_at: &str,
    odometer: Option<i64>,
    user_id: i64,
) -> AppResult<String> {
    // performed_at arrives as YYYY-MM-DD from a date input; store midnight UTC.
    let ts = format!("{performed_at}T00:00:00Z");
    if chrono::DateTime::parse_from_rfc3339(&ts).is_err() {
        return Err(AppError::Internal(format!("invalid date: {performed_at}")));
    }
    let wo_id = Uuid::new_v4().to_string();
    let task_id = Uuid::new_v4().to_string();
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();
    tx.execute(
        "INSERT INTO work_orders
           (id, vehicle_id, status, title, odometer_at_open, opened_at, closed_at,
            created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,'closed',NULL,?3,?4,?4,?5,?5,?6,?6,1)",
        params![wo_id, vehicle_id, odometer, ts, now, user_id],
    )?;
    enqueue_row(&tx, "work_orders", &wo_id, "insert", user_id)?;
    tx.execute(
        "INSERT INTO work_order_tasks
           (id, work_order_id, kind, category_id, is_done, sort_order,
            created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,'free',?3,1,1,?4,?4,?5,?5,1)",
        params![task_id, wo_id, category_id, now, user_id],
    )?;
    enqueue_row(&tx, "work_order_tasks", &task_id, "insert", user_id)?;
    tx.commit()?;
    Ok(wo_id)
}

pub fn wo_add_task(
    pool: &DbPool,
    work_order_id: &str,
    category_id: Option<&str>,
    description_ar: &str,
    user_id: i64,
) -> AppResult<String> {
    let id = Uuid::new_v4().to_string();
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();
    let sort: i64 = tx.query_row(
        "SELECT COALESCE(MAX(sort_order),0)+1 FROM work_order_tasks WHERE work_order_id=?1",
        params![work_order_id],
        |r| r.get(0),
    )?;
    // is_done = 0: adding a task is PLANNING. Only checking it off (or the
    // oil flow, which records performed work) resets the due clock — before
    // this, "add as task" from the due suggestions reset preventive coverage
    // the instant it was clicked.
    tx.execute(
        "INSERT INTO work_order_tasks
           (id, work_order_id, kind, category_id, description_ar, is_done, sort_order,
            created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,'free',?3,?4,0,?5,?6,?6,?7,?7,1)",
        params![id, work_order_id, category_id, description_ar, sort, now, user_id],
    )?;
    enqueue_row(&tx, "work_order_tasks", &id, "insert", user_id)?;
    tx.commit()?;
    Ok(id)
}

/// Check/uncheck a task. Done-ness is what resets the due clock (0017), so
/// this is the mechanic's "the work actually happened" statement.
pub fn wo_task_set_done(pool: &DbPool, task_id: &str, done: bool, user_id: i64) -> AppResult<()> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let n = tx.execute(
        "UPDATE work_order_tasks SET is_done=?2, updated_at=?3, updated_by_user_id=?4
          WHERE id=?1 AND deleted_at IS NULL",
        params![task_id, done as i64, now_iso(), user_id],
    )?;
    if n == 0 {
        return Err(AppError::Internal("task not found".into()));
    }
    enqueue_row(&tx, "work_order_tasks", task_id, "update", user_id)?;
    tx.commit()?;
    Ok(())
}

pub fn wo_delete_task(pool: &DbPool, task_id: &str, user_id: i64) -> AppResult<()> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE work_order_tasks SET deleted_at=?2, updated_at=?2, updated_by_user_id=?3 WHERE id=?1",
        params![task_id, now_iso(), user_id],
    )?;
    enqueue_row(&tx, "work_order_tasks", task_id, "delete", user_id)?;
    tx.commit()?;
    Ok(())
}

/// Oil change: oil row + an `oil`-kind task row (drives the due engine's
/// last-done for the oil_change category), both queued. No local stock
/// decrement — the mirror stays a server snapshot; projection happens at read.
pub fn oil_add(
    pool: &DbPool,
    work_order_id: &str,
    vehicle_id: i64,
    oil_type: &str,
    liters: f64,
    odometer: Option<i64>,
    user_id: i64,
) -> AppResult<(String, bool)> {
    if liters <= 0.0 {
        return Err(AppError::Internal("liters must be > 0".into()));
    }
    let flagged = oil_flagged(liters);
    let oil_id = Uuid::new_v4().to_string();
    let task_id = Uuid::new_v4().to_string();
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();
    tx.execute(
        "INSERT INTO oil_changes
           (id, work_order_id, vehicle_id, oil_type, liters, odometer, flagged, performed_at,
            created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8,?8,?9,?9,1)",
        params![oil_id, work_order_id, vehicle_id, oil_type, liters, odometer, flagged as i64, now, user_id],
    )?;
    enqueue_row(&tx, "oil_changes", &oil_id, "insert", user_id)?;
    tx.execute(
        "INSERT INTO work_order_tasks
           (id, work_order_id, kind, category_id, is_done, sort_order,
            created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,'oil','oil_change',1,
                 (SELECT COALESCE(MAX(sort_order),0)+1 FROM work_order_tasks WHERE work_order_id=?2),
                 ?3,?3,?4,?4,1)",
        params![task_id, work_order_id, now, user_id],
    )?;
    enqueue_row(&tx, "work_order_tasks", &task_id, "insert", user_id)?;
    tx.commit()?;
    Ok((oil_id, flagged))
}

// ═════════════════════════════ odometer / class ══════════════════════════════

pub fn override_set(
    pool: &DbPool,
    vehicle_id: i64,
    odometer: i64,
    notes: Option<&str>,
    user_id: i64,
) -> AppResult<()> {
    if odometer < 0 {
        return Err(AppError::Internal("odometer must be ≥ 0".into()));
    }
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();
    let existed: Option<i64> = tx
        .query_row(
            "SELECT sync_version FROM vehicle_odometer_overrides WHERE vehicle_id = ?1",
            params![vehicle_id],
            |r| r.get(0),
        )
        .optional()?;
    // Record the Falcon reading being corrected: the arbitration discards it
    // until the truck genuinely drives past it (mirrors server 0014).
    let superseded: Option<i64> = tx
        .query_row(
            "SELECT last_fuel_odometer FROM vehicles_cache WHERE id = ?1",
            params![vehicle_id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    tx.execute(
        "INSERT INTO vehicle_odometer_overrides
           (vehicle_id, odometer, set_at, notes, superseded_km, created_at, updated_at,
            created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?4,?5,?3,?3,?6,?6,1)
         ON CONFLICT(vehicle_id) DO UPDATE SET
           odometer=excluded.odometer, set_at=excluded.set_at, notes=excluded.notes,
           superseded_km=excluded.superseded_km,
           updated_at=excluded.updated_at, updated_by_user_id=excluded.updated_by_user_id",
        params![vehicle_id, odometer, now, notes, superseded, user_id],
    )?;
    let op = if existed.is_some() { "update" } else { "insert" };
    enqueue_row(&tx, "vehicle_odometer_overrides", &vehicle_id.to_string(), op, user_id)?;
    tx.commit()?;
    Ok(())
}

/// Tag a vehicle with a maintenance class (drives the fleet-wide service plans).
pub fn class_assign(pool: &DbPool, vehicle_id: i64, class_id: &str, user_id: i64) -> AppResult<()> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();
    let existed: Option<i64> = tx
        .query_row(
            "SELECT sync_version FROM vehicle_class_assignments WHERE vehicle_id = ?1",
            params![vehicle_id],
            |r| r.get(0),
        )
        .optional()?;
    tx.execute(
        "INSERT INTO vehicle_class_assignments
           (vehicle_id, class_id, created_at, updated_at,
            created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?3,?4,?4,1)
         ON CONFLICT(vehicle_id) DO UPDATE SET
           class_id=excluded.class_id, deleted_at=NULL,
           updated_at=excluded.updated_at, updated_by_user_id=excluded.updated_by_user_id",
        params![vehicle_id, class_id, now, user_id],
    )?;
    // The server upserts class assignments on insert, so insert covers both
    // the fresh tag and the re-tag.
    let _ = existed;
    enqueue_row(&tx, "vehicle_class_assignments", &vehicle_id.to_string(), "insert", user_id)?;
    tx.commit()?;
    Ok(())
}

// ═════════════════════════════ tires ═════════════════════════════════════════

#[derive(Debug, Deserialize, specta::Type)]
pub struct MountFromStockInput {
    pub position_id: String,
    pub vehicle_id: i64,
    pub work_order_id: String,
    /// The fungible stock line being consumed.
    pub brand: String,
    pub model: Option<String>,
    pub size: Option<String>,
    /// Identity captured at the only moment you hold the tire: optional but
    /// this is the moment to fill it.
    pub dot_code: Option<String>,
    pub odometer: Option<i64>,
}

/// Mount a NEW tire from fungible stock: mints the individual asset (identity
/// capture) + the assignment, both queued. The server derives the stock debit
/// from the shipment-origin tire insert — the client never posts a debit.
pub fn mount_from_stock(
    pool: &DbPool,
    inp: &MountFromStockInput,
    user_id: i64,
) -> AppResult<(String, String)> {
    let tire_id = Uuid::new_v4().to_string();
    let assignment_id = Uuid::new_v4().to_string();
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();
    let dot = inp.dot_code.as_deref().map(str::trim).filter(|s| !s.is_empty());
    tx.execute(
        "INSERT INTO tires
           (id, dot_code, brand, model, size, status, origin, total_km, retread_count,
            created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?4,?5,'mounted','shipment',0,0,?6,?6,?7,?7,1)",
        params![tire_id, dot, inp.brand, inp.model, inp.size, now, user_id],
    )?;
    enqueue_row(&tx, "tires", &tire_id, "insert", user_id)?;
    insert_assignment(&tx, &assignment_id, &tire_id, inp.position_id.as_str(), inp.vehicle_id,
                      Some(inp.work_order_id.as_str()), inp.odometer, "new", &now, user_id)?;
    enqueue_row(&tx, "tire_assignments", &assignment_id, "insert", user_id)?;
    tx.commit()?;
    Ok((tire_id, assignment_id))
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct MountUsedInput {
    pub tire_id: String,
    pub position_id: String,
    pub vehicle_id: i64,
    pub work_order_id: String,
    pub odometer: Option<i64>,
    /// new | rotation | replacement | repair_return | onboard
    pub reason: String,
}

/// Mount an existing pool tire. Local status flip mirrors the server's
/// derivation and is NOT enqueued.
pub fn mount_used(pool: &DbPool, inp: &MountUsedInput, user_id: i64) -> AppResult<String> {
    let assignment_id = Uuid::new_v4().to_string();
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();

    let status: Option<String> = tx
        .query_row(
            "SELECT status FROM tires WHERE id=?1 AND deleted_at IS NULL",
            params![inp.tire_id],
            |r| r.get(0),
        )
        .optional()?;
    match status.as_deref() {
        Some("in_stock_used") => {}
        Some(other) => {
            return Err(AppError::Internal(format!("tire is {other}, not in_stock_used")));
        }
        None => return Err(AppError::Internal("tire not found".into())),
    }

    insert_assignment(&tx, &assignment_id, &inp.tire_id, &inp.position_id, inp.vehicle_id,
                      Some(&inp.work_order_id), inp.odometer, &inp.reason, &now, user_id)?;
    enqueue_row(&tx, "tire_assignments", &assignment_id, "insert", user_id)?;
    // Server-derived projection, applied locally, never enqueued.
    tx.execute(
        "UPDATE tires SET status='mounted', updated_at=?2 WHERE id=?1",
        params![inp.tire_id, now],
    )?;
    tx.commit()?;
    Ok(assignment_id)
}

#[allow(clippy::too_many_arguments)]
/// Reasons the server's Postgres enums accept (maint-rust 0003). An
/// unvalidated string mounts/dismounts locally and then dead-letters on the
/// enum cast — local state the server never accepted.
const MOUNT_REASONS: &[&str] = &["new", "rotation", "replacement", "repair_return", "onboard"];
const DISMOUNT_REASONS: &[&str] = &["worn", "damaged", "rotation", "puncture", "retread", "other"];

#[allow(clippy::too_many_arguments)] // internal helper: one row's full column set
fn insert_assignment(
    tx: &Connection,
    id: &str,
    tire_id: &str,
    position_id: &str,
    vehicle_id: i64,
    work_order_id: Option<&str>,
    odometer: Option<i64>,
    reason: &str,
    now: &str,
    user_id: i64,
) -> AppResult<()> {
    if !MOUNT_REASONS.contains(&reason) {
        return Err(AppError::Internal(format!("invalid mount reason: {reason}")));
    }
    // Local guards mirroring the server's TWO partial unique indexes: one
    // active assignment per position AND one per tire.
    let occupied: Option<String> = tx
        .query_row(
            "SELECT id FROM tire_assignments
              WHERE position_id=?1 AND dismounted_at IS NULL AND deleted_at IS NULL",
            params![position_id],
            |r| r.get(0),
        )
        .optional()?;
    if occupied.is_some() {
        return Err(AppError::Internal("position already has an active tire".into()));
    }
    let riding: Option<String> = tx
        .query_row(
            "SELECT id FROM tire_assignments
              WHERE tire_id=?1 AND dismounted_at IS NULL AND deleted_at IS NULL",
            params![tire_id],
            |r| r.get(0),
        )
        .optional()?;
    if riding.is_some() {
        return Err(AppError::Internal("tire already has an active assignment".into()));
    }
    tx.execute(
        "INSERT INTO tire_assignments
           (id, tire_id, position_id, vehicle_id, work_order_id, mounted_at, mounted_odometer,
            mount_reason, created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?6,?6,?9,?9,1)",
        params![id, tire_id, position_id, vehicle_id, work_order_id, now, odometer, reason, user_id],
    )?;
    Ok(())
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct DismountInput {
    pub assignment_id: String,
    pub odometer: Option<i64>,
    /// worn | damaged | rotation | puncture | retread | other
    pub reason: String,
    /// The WO this dismount happens under — NOT the assignment's own
    /// work_order_id, which belongs to the mount.
    pub work_order_id: Option<String>,
}

/// Dismount: close the assignment (queued). Status + km are the server's
/// derivation; the same rule is applied locally for immediate UX, not enqueued.
pub fn dismount(pool: &DbPool, inp: &DismountInput, user_id: i64) -> AppResult<String> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();

    if !DISMOUNT_REASONS.contains(&inp.reason.as_str()) {
        return Err(AppError::Internal(format!("invalid dismount reason: {}", inp.reason)));
    }
    let row: Option<String> = tx
        .query_row(
            "SELECT ta.tire_id FROM tire_assignments ta
              WHERE ta.id=?1 AND ta.dismounted_at IS NULL AND ta.deleted_at IS NULL",
            params![inp.assignment_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(tire_id) = row else {
        return Err(AppError::Internal("active assignment not found".into()));
    };

    tx.execute(
        "UPDATE tire_assignments SET dismounted_at=?2, dismounted_odometer=?3,
            dismount_reason=?4, dismount_work_order_id=?5, updated_at=?2, updated_by_user_id=?6
          WHERE id=?1",
        params![inp.assignment_id, now, inp.odometer, inp.reason, inp.work_order_id, user_id],
    )?;
    enqueue_row(&tx, "tire_assignments", &inp.assignment_id, "update", user_id)?;

    // Local mirror of the server derivation (never enqueued). Status only —
    // lifetime km is DERIVED from the assignment history, never accrued.
    let to_status = dismount_status(&inp.reason);
    tx.execute(
        "UPDATE tires SET status=?2, updated_at=?3 WHERE id=?1",
        params![tire_id, to_status, now],
    )?;
    tx.commit()?;
    Ok(tire_id)
}

/// Correct the odometer snapshots on a historical mount/dismount. Lifetime km
/// is derived from these, so an edit repropagates everywhere instantly.
pub fn assignment_set_odometers(
    pool: &DbPool,
    assignment_id: &str,
    mounted_odometer: Option<i64>,
    dismounted_odometer: Option<i64>,
    user_id: i64,
) -> AppResult<()> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();

    let closed: Option<Option<String>> = tx
        .query_row(
            "SELECT dismounted_at FROM tire_assignments WHERE id=?1 AND deleted_at IS NULL",
            params![assignment_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(dismounted_at) = closed else {
        return Err(AppError::Internal("assignment not found".into()));
    };
    if dismounted_odometer.is_some() && dismounted_at.is_none() {
        return Err(AppError::Internal("assignment is still mounted — no dismount odometer".into()));
    }

    tx.execute(
        "UPDATE tire_assignments SET
            mounted_odometer    = COALESCE(?2, mounted_odometer),
            dismounted_odometer = COALESCE(?3, dismounted_odometer),
            updated_at = ?4, updated_by_user_id = ?5
          WHERE id = ?1",
        params![assignment_id, mounted_odometer, dismounted_odometer, now, user_id],
    )?;
    let (m, d): (Option<i64>, Option<i64>) = tx.query_row(
        "SELECT mounted_odometer, dismounted_odometer FROM tire_assignments WHERE id=?1",
        params![assignment_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if let (Some(m), Some(d)) = (m, d) {
        if d < m {
            return Err(AppError::Internal("dismount odometer must be ≥ mount odometer".into()));
        }
    }
    enqueue_row(&tx, "tire_assignments", assignment_id, "update", user_id)?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct OnboardPositionInput {
    pub position_id: String,
    pub vehicle_id: i64,
    pub brand: String,
    pub model: Option<String>,
    pub size: Option<String>,
    pub dot_code: Option<String>,
    /// Best-guess km already run (optional, becomes the asset's starting total).
    pub estimated_km: Option<i64>,
}

/// First-time onboarding of rubber already ON the truck: mints a legacy asset
/// already mounted. No stock effect anywhere (origin = legacy).
pub fn onboard_position(
    pool: &DbPool,
    inp: &OnboardPositionInput,
    user_id: i64,
) -> AppResult<(String, String)> {
    let tire_id = Uuid::new_v4().to_string();
    let assignment_id = Uuid::new_v4().to_string();
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();
    let dot = inp.dot_code.as_deref().map(str::trim).filter(|s| !s.is_empty());
    tx.execute(
        "INSERT INTO tires
           (id, dot_code, brand, model, size, status, origin, total_km, retread_count,
            created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?4,?5,'mounted','legacy',?6,0,?7,?7,?8,?8,1)",
        params![tire_id, dot, inp.brand, inp.model, inp.size, inp.estimated_km.unwrap_or(0), now, user_id],
    )?;
    enqueue_row(&tx, "tires", &tire_id, "insert", user_id)?;
    insert_assignment(&tx, &assignment_id, &tire_id, &inp.position_id, inp.vehicle_id,
                      None, None, "onboard", &now, user_id)?;
    enqueue_row(&tx, "tire_assignments", &assignment_id, "insert", user_id)?;
    tx.commit()?;
    Ok((tire_id, assignment_id))
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct LegacyTireInput {
    pub brand: String,
    pub model: Option<String>,
    pub size: Option<String>,
    pub dot_code: Option<String>,
    pub estimated_km: Option<i64>,
}

/// Bulk intake of used tires sitting in the yard → individuated used stock.
pub fn intake_legacy(pool: &DbPool, tires: &[LegacyTireInput], user_id: i64) -> AppResult<Vec<String>> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();
    let mut ids = Vec::with_capacity(tires.len());
    for t in tires {
        let id = Uuid::new_v4().to_string();
        let dot = t.dot_code.as_deref().map(str::trim).filter(|s| !s.is_empty());
        tx.execute(
            "INSERT INTO tires
               (id, dot_code, brand, model, size, status, origin, total_km, retread_count,
                created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
             VALUES (?1,?2,?3,?4,?5,'in_stock_used','legacy',?6,0,?7,?7,?8,?8,1)",
            params![id, dot, t.brand, t.model, t.size, t.estimated_km.unwrap_or(0), now, user_id],
        )?;
        enqueue_row(&tx, "tires", &id, "insert", user_id)?;
        ids.push(id);
    }
    tx.commit()?;
    Ok(ids)
}

/// Explicit lifecycle transition from the tire file (repair out/in, retread
/// send, restock, scrap). Mount/dismount is NOT done here — assignments carry
/// those.
///
/// Only the EVENT is enqueued; the server derives tires.status from it
/// (side_effects, TireStatusEvents insert) and the local status flip below is
/// the same projection, applied for immediate UX. Enqueueing a `tires` update
/// here was a guaranteed offline dead-letter: every assignment side effect
/// bumps tires.sync_version server-side, so a queued tires update carried a
/// structurally stale base whenever a mount/dismount preceded it in the batch.
pub fn tire_set_status(
    pool: &DbPool,
    tire_id: &str,
    to_status: &str,
    event_type: &str,
    notes: Option<&str>,
    user_id: i64,
) -> AppResult<()> {
    if !["in_stock_used", "in_repair", "retreading", "scrapped"].contains(&to_status) {
        return Err(AppError::Internal(format!("invalid destination status: {to_status}")));
    }
    if !["scrap", "retread", "repair_out", "repair_in", "restock", "intake"].contains(&event_type) {
        return Err(AppError::Internal(format!("invalid event type: {event_type}")));
    }
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();

    let from_status: Option<String> = tx
        .query_row(
            "SELECT status FROM tires WHERE id=?1 AND deleted_at IS NULL",
            params![tire_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(from_status) = from_status else {
        return Err(AppError::Internal("tire not found".into()));
    };
    if from_status == "mounted" {
        return Err(AppError::Internal("dismount the tire first".into()));
    }

    // Local projection of the server's event-driven derivation — never enqueued.
    tx.execute(
        "UPDATE tires SET status=?2, updated_at=?3, updated_by_user_id=?4 WHERE id=?1",
        params![tire_id, to_status, now, user_id],
    )?;
    // A restock FROM the retreader is a completed retread — the lineage
    // counter finally moves (it was schema-only before).
    if event_type == "restock" && from_status == "retreading" {
        tx.execute(
            "UPDATE tires SET retread_count = retread_count + 1 WHERE id=?1",
            params![tire_id],
        )?;
    }

    let event_id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO tire_status_events
           (id, tire_id, event_type, from_status, to_status, notes, occurred_at,
            created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?7,?7,?8,?8,1)",
        params![event_id, tire_id, event_type, from_status, to_status, notes, now, user_id],
    )?;
    enqueue_row(&tx, "tire_status_events", &event_id, "insert", user_id)?;
    tx.commit()?;
    Ok(())
}

// ═════════════════════════════ chassis ═══════════════════════════════════════

#[derive(Debug, Deserialize, specta::Type)]
pub struct ChassisConfig {
    /// Tractor axles behind the steering axle (dual wheels each).
    pub drive_axles: i64,
    pub trailer_axles: i64,
    pub spares: i64,
    pub single_trailer_axles: Option<bool>,
}

/// Create a layout + axles + positions for a vehicle in one shot, mirroring
/// maint-rust's chassis codes exactly:
///   tractor single: H{n}L/H{n}R · dual: H{n}LO/LI/RI/RO · trailer: TR{n}… · spare: SP{n}
/// Guarded escape hatch for a wrong chassis: soft-delete the whole layout
/// tree so the wizard can rebuild it. Refused while any position holds an
/// active assignment — dismount everything first.
pub fn chassis_delete(pool: &DbPool, vehicle_id: i64, user_id: i64) -> AppResult<()> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let layout: Option<String> = tx
        .query_row(
            "SELECT id FROM chassis_layouts WHERE vehicle_id=?1 AND deleted_at IS NULL",
            params![vehicle_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(layout_id) = layout else {
        return Err(AppError::Internal("vehicle has no chassis layout".into()));
    };
    let mounted: i64 = tx.query_row(
        "SELECT COUNT(*) FROM tire_assignments ta
          JOIN chassis_positions p ON p.id = ta.position_id
         WHERE p.layout_id=?1 AND ta.dismounted_at IS NULL AND ta.deleted_at IS NULL",
        params![layout_id],
        |r| r.get(0),
    )?;
    if mounted > 0 {
        return Err(AppError::Internal(format!(
            "chassis has {mounted} mounted tires — dismount them first"
        )));
    }
    let now = now_iso();
    // Children first so the server's FIFO delete order never dangles.
    let pos_ids: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT id FROM chassis_positions WHERE layout_id=?1 AND deleted_at IS NULL",
        )?;
        let v = stmt
            .query_map(params![layout_id], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        v
    };
    let axle_ids: Vec<String> = {
        let mut stmt = tx
            .prepare("SELECT id FROM chassis_axles WHERE layout_id=?1 AND deleted_at IS NULL")?;
        let v = stmt
            .query_map(params![layout_id], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        v
    };
    for id in &pos_ids {
        tx.execute(
            "UPDATE chassis_positions SET deleted_at=?2, updated_at=?2, updated_by_user_id=?3 WHERE id=?1",
            params![id, now, user_id],
        )?;
        enqueue_row(&tx, "chassis_positions", id, "delete", user_id)?;
    }
    for id in &axle_ids {
        tx.execute(
            "UPDATE chassis_axles SET deleted_at=?2, updated_at=?2, updated_by_user_id=?3 WHERE id=?1",
            params![id, now, user_id],
        )?;
        enqueue_row(&tx, "chassis_axles", id, "delete", user_id)?;
    }
    tx.execute(
        "UPDATE chassis_layouts SET deleted_at=?2, updated_at=?2, updated_by_user_id=?3 WHERE id=?1",
        params![layout_id, now, user_id],
    )?;
    enqueue_row(&tx, "chassis_layouts", &layout_id, "delete", user_id)?;
    tx.commit()?;
    Ok(())
}

pub fn chassis_create(pool: &DbPool, vehicle_id: i64, cfg: &ChassisConfig, user_id: i64) -> AppResult<String> {
    if cfg.drive_axles < 1 || cfg.trailer_axles < 0 || cfg.spares < 0 {
        return Err(AppError::Internal("invalid chassis config".into()));
    }
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();

    let existing: Option<String> = tx
        .query_row(
            "SELECT id FROM chassis_layouts WHERE vehicle_id=?1 AND deleted_at IS NULL",
            params![vehicle_id],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_some() {
        return Err(AppError::Internal("vehicle already has a chassis layout".into()));
    }

    let plan = crate::services::chassis_plan::plan_chassis(&crate::services::chassis_plan::PlanConfig {
        drive_axles: cfg.drive_axles,
        trailer_axles: cfg.trailer_axles,
        spares: cfg.spares,
        single_trailer_axles: cfg.single_trailer_axles.unwrap_or(false),
    })
    .map_err(AppError::Internal)?;

    let layout_id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO chassis_layouts
           (id, vehicle_id, name_ar, name_en, created_at, updated_at,
            created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?4,?5,?5,?6,?6,1)",
        params![layout_id, vehicle_id, "الشاسيه", "Chassis", now, user_id],
    )?;
    enqueue_row(&tx, "chassis_layouts", &layout_id, "insert", user_id)?;

    // Persist the pure plan: axles first (positions reference them by id).
    let mut axle_ids: Vec<String> = Vec::with_capacity(plan.axles.len());
    for a in &plan.axles {
        let id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO chassis_axles
               (id, layout_id, section, section_index, axle_type, is_steering, is_lifted,
                created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
             VALUES (?1,?2,?3,?4,?5,?6,0,?7,?7,?8,?8,1)",
            params![id, layout_id, a.section, a.index, a.axle_type, a.is_steering as i64, now, user_id],
        )?;
        enqueue_row(&tx, "chassis_axles", &id, "insert", user_id)?;
        axle_ids.push(id);
    }
    for p in &plan.positions {
        let id = Uuid::new_v4().to_string();
        let axle_id = p.axle.map(|ix| axle_ids[ix].as_str());
        tx.execute(
            "INSERT INTO chassis_positions
               (id, layout_id, axle_id, side, depth, is_spare, spare_index, position_code,
                created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,?10,?10,1)",
            params![id, layout_id, axle_id, p.side, p.depth, p.is_spare as i64, p.spare_index, p.code, now, user_id],
        )?;
        enqueue_row(&tx, "chassis_positions", &id, "insert", user_id)?;
    }

    tx.commit()?;
    Ok(layout_id)
}
