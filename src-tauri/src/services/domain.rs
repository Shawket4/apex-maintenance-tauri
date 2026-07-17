//! Owned-domain operations against the LOCAL database.
//!
//! Every write is one SQLite transaction that (a) applies the change to the
//! local table and (b) enqueues the same row in the outbox. Reads come
//! straight from the local tables — the local database IS the working truth;
//! the outbox is the record of what the server hasn't confirmed yet.
//!
//! Nothing here talks to the network. The engine drains the outbox; the
//! commands layer kicks it after each write.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::DbPool;
use crate::services::outbox;
use crate::{AppError, AppResult};

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Read a full row back as JSON (the outbox payload is always the row snapshot).
fn row_snapshot(conn: &Connection, table: &str, pk: &str, id: &str) -> AppResult<Value> {
    let cols = crate::services::engine::columns_for_public(table);
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
                        let s = String::from_utf8_lossy(t).to_string();
                        // attachments is stored as JSON text; ship it as JSON.
                        if *c == "attachments" {
                            serde_json::from_str(&s).unwrap_or(Value::String(s))
                        } else {
                            Value::String(s)
                        }
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
/// JSON booleans for boolean-typed columns.
fn fix_bools(entity: &str, mut row: Value) -> Value {
    let bool_cols: &[&str] = match entity {
        "maintenance_templates" => &["is_active"],
        "chassis_axles" => &["is_steering", "is_lifted"],
        "chassis_positions" => &["is_spare"],
        "tires" => &["is_retread"],
        _ => &[],
    };
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
fn enqueue_row(
    tx: &Connection,
    entity: &str,
    id: &str,
    op: &str,
    user_id: i64,
) -> AppResult<()> {
    let pk = if entity == "vehicle_odometer_overrides" { "vehicle_id" } else { "id" };
    let snapshot = fix_bools(entity, row_snapshot(tx, entity, pk, id)?);
    let base_sv = snapshot.get("sync_version").and_then(|v| v.as_i64()).unwrap_or(1);
    // For inserts the server accepts any version; for updates the base is the
    // last server-acked version, which is exactly what the local row carries.
    outbox::enqueue(tx, entity, id, op, &snapshot, if op == "insert" { 0 } else { base_sv }, user_id)?;
    Ok(())
}

// ═════════════════════════════ templates ═════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct TemplateInput {
    pub vehicle_id: i64,
    pub category_id: String,
    pub name_ar: String,
    pub name_en: String,
    pub notes_ar: Option<String>,
    pub notes_en: Option<String>,
    pub trigger_type: String, // 'mileage' | 'time'
    pub interval_km: Option<i64>,
    pub interval_days: Option<i64>,
    pub lead_warn_km: Option<i64>,
    pub lead_warn_days: Option<i64>,
}

pub fn template_create(pool: &DbPool, inp: &TemplateInput, user_id: i64) -> AppResult<String> {
    match (inp.trigger_type.as_str(), inp.interval_km, inp.interval_days) {
        ("mileage", Some(km), _) if km > 0 => {}
        ("time", _, Some(d)) if d > 0 => {}
        _ => {
            return Err(AppError::Internal(
                "trigger_type mileage needs interval_km > 0; time needs interval_days > 0".into(),
            ))
        }
    }
    let id = Uuid::new_v4().to_string();
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();
    tx.execute(
        "INSERT INTO maintenance_templates
           (id, vehicle_id, category_id, name_ar, name_en, notes_ar, notes_en, trigger_type,
            interval_km, interval_days, lead_warn_km, lead_warn_days, is_active,
            created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,1,?13,?13,?14,?14,1)",
        params![
            id, inp.vehicle_id, inp.category_id, inp.name_ar, inp.name_en, inp.notes_ar,
            inp.notes_en, inp.trigger_type, inp.interval_km, inp.interval_days,
            inp.lead_warn_km.unwrap_or(500), inp.lead_warn_days.unwrap_or(14), now, user_id
        ],
    )?;
    enqueue_row(&tx, "maintenance_templates", &id, "insert", user_id)?;
    tx.commit()?;
    Ok(id)
}

pub fn template_update(pool: &DbPool, id: &str, inp: &TemplateInput, user_id: i64) -> AppResult<()> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let n = tx.execute(
        "UPDATE maintenance_templates SET
            category_id=?2, name_ar=?3, name_en=?4, notes_ar=?5, notes_en=?6, trigger_type=?7,
            interval_km=?8, interval_days=?9, lead_warn_km=?10, lead_warn_days=?11, updated_at=?12,
            updated_by_user_id=?13
          WHERE id=?1 AND deleted_at IS NULL",
        params![
            id, inp.category_id, inp.name_ar, inp.name_en, inp.notes_ar, inp.notes_en,
            inp.trigger_type, inp.interval_km, inp.interval_days,
            inp.lead_warn_km.unwrap_or(500), inp.lead_warn_days.unwrap_or(14), now_iso(), user_id
        ],
    )?;
    if n == 0 {
        return Err(AppError::Internal("template not found".into()));
    }
    enqueue_row(&tx, "maintenance_templates", id, "update", user_id)?;
    tx.commit()?;
    Ok(())
}

pub fn template_delete(pool: &DbPool, id: &str, user_id: i64) -> AppResult<()> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE maintenance_templates SET deleted_at=?2, updated_at=?2, updated_by_user_id=?3 WHERE id=?1",
        params![id, now_iso(), user_id],
    )?;
    enqueue_row(&tx, "maintenance_templates", id, "delete", user_id)?;
    tx.commit()?;
    Ok(())
}

// ═════════════════════════════ records ═══════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct RecordInput {
    pub template_id: Option<String>,
    pub vehicle_id: i64,
    pub category_id: String,
    pub performed_at: String,
    pub odometer_at_service: Option<i64>,
    pub cost: Option<f64>,
    pub vendor: Option<String>,
    pub performed_by: Option<String>,
    pub notes: Option<String>,
}

/// Creating a record also resets the template's clock: next_due is derived
/// from the template interval + this record's odometer/date.
pub fn record_create(pool: &DbPool, inp: &RecordInput, user_id: i64) -> AppResult<String> {
    let id = Uuid::new_v4().to_string();
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;

    let (mut next_due_at, mut next_due_km): (Option<String>, Option<i64>) = (None, None);
    if let Some(tid) = &inp.template_id {
        let tpl: Option<(String, Option<i64>, Option<i64>)> = tx
            .query_row(
                "SELECT trigger_type, interval_km, interval_days
                   FROM maintenance_templates WHERE id = ?1 AND deleted_at IS NULL",
                params![tid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        if let Some((trigger, km, days)) = tpl {
            match trigger.as_str() {
                "mileage" => {
                    next_due_km = match (inp.odometer_at_service, km) {
                        (Some(o), Some(k)) => Some(o + k),
                        _ => None,
                    }
                }
                "time" => {
                    if let Some(d) = days {
                        let base = chrono::DateTime::parse_from_rfc3339(&inp.performed_at)
                            .map_err(|e| AppError::Internal(format!("performed_at: {e}")))?;
                        next_due_at = Some(
                            (base + chrono::Duration::days(d))
                                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                        );
                    }
                }
                _ => {}
            }
        }
    }

    let now = now_iso();
    tx.execute(
        "INSERT INTO maintenance_records
           (id, template_id, vehicle_id, category_id, performed_at, odometer_at_service,
            next_due_at, next_due_km, cost, vendor, performed_by, notes, attachments,
            created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'[]',?13,?13,?14,?14,1)",
        params![
            id, inp.template_id, inp.vehicle_id, inp.category_id, inp.performed_at,
            inp.odometer_at_service, next_due_at, next_due_km, inp.cost, inp.vendor,
            inp.performed_by, inp.notes, now, user_id
        ],
    )?;
    enqueue_row(&tx, "maintenance_records", &id, "insert", user_id)?;
    tx.commit()?;
    Ok(id)
}

pub fn record_delete(pool: &DbPool, id: &str, user_id: i64) -> AppResult<()> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE maintenance_records SET deleted_at=?2, updated_at=?2, updated_by_user_id=?3 WHERE id=?1",
        params![id, now_iso(), user_id],
    )?;
    enqueue_row(&tx, "maintenance_records", id, "delete", user_id)?;
    tx.commit()?;
    Ok(())
}

// ═════════════════════════════ odometer override ═════════════════════════════

pub fn override_set(pool: &DbPool, vehicle_id: i64, odometer: i64, notes: Option<&str>, user_id: i64) -> AppResult<()> {
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
    tx.execute(
        "INSERT INTO vehicle_odometer_overrides
           (vehicle_id, odometer, set_at, notes, created_at, updated_at,
            created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?4,?3,?3,?5,?5,1)
         ON CONFLICT(vehicle_id) DO UPDATE SET
           odometer=excluded.odometer, set_at=excluded.set_at, notes=excluded.notes,
           updated_at=excluded.updated_at, updated_by_user_id=excluded.updated_by_user_id",
        params![vehicle_id, odometer, now, notes, user_id],
    )?;
    // The server's override endpoint upserts on insert, so a fresh insert op is
    // correct for both cases; an existing row keeps optimistic concurrency.
    let op = if existed.is_some() { "update" } else { "insert" };
    enqueue_row(&tx, "vehicle_odometer_overrides", &vehicle_id.to_string(), op, user_id)?;
    tx.commit()?;
    Ok(())
}

// ═════════════════════════════ tires ═════════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct TireInput {
    pub dot_code: String,
    pub brand: String,
    pub model: Option<String>,
    pub purchase_date: Option<String>,
    pub purchase_cost: Option<f64>,
    pub supplier: Option<String>,
    pub is_retread: Option<bool>,
    pub stock_location: Option<String>,
    pub notes: Option<String>,
}

pub fn tire_create(pool: &DbPool, inp: &TireInput, user_id: i64) -> AppResult<String> {
    let id = Uuid::new_v4().to_string();
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();
    tx.execute(
        "INSERT INTO tires
           (id, dot_code, brand, model, purchase_date, purchase_cost, supplier,
            is_retread, retread_count, status, stock_location, notes,
            created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,'in_stock',?9,?10,?11,?11,?12,?12,1)",
        params![
            id, inp.dot_code.trim(), inp.brand, inp.model, inp.purchase_date, inp.purchase_cost,
            inp.supplier, inp.is_retread.unwrap_or(false) as i64, inp.stock_location, inp.notes,
            now, user_id
        ],
    )?;
    enqueue_row(&tx, "tires", &id, "insert", user_id)?;
    tx.commit()?;
    Ok(id)
}

/// Mount a tire onto a position. One transaction: assignment insert + tire
/// status flip + both outbox rows. The partial unique indexes (one active
/// assignment per position / per tire) enforce the domain invariant.
pub fn tire_mount(
    pool: &DbPool,
    tire_id: &str,
    position_id: &str,
    vehicle_id: i64,
    odometer: Option<i64>,
    reason: &str,
    user_id: i64,
) -> AppResult<String> {
    let id = Uuid::new_v4().to_string();
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();

    let status: Option<String> = tx
        .query_row("SELECT status FROM tires WHERE id=?1 AND deleted_at IS NULL", params![tire_id], |r| r.get(0))
        .optional()?;
    match status.as_deref() {
        Some("in_stock") => {}
        Some(other) => {
            return Err(AppError::Internal(format!("tire is {other}, not in_stock")));
        }
        None => return Err(AppError::Internal("tire not found".into())),
    }

    tx.execute(
        "INSERT INTO tire_assignments
           (id, tire_id, position_id, vehicle_id, mounted_at, mounted_odometer, mount_reason,
            created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?5,?5,?8,?8,1)",
        params![id, tire_id, position_id, vehicle_id, now, odometer, reason, user_id],
    )
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(err, Some(msg))
            if err.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            AppError::Internal(format!("position or tire already has an active assignment ({msg})"))
        }
        other => AppError::Db(other),
    })?;
    tx.execute(
        "UPDATE tires SET status='mounted', updated_at=?2, updated_by_user_id=?3 WHERE id=?1",
        params![tire_id, now, user_id],
    )?;

    enqueue_row(&tx, "tire_assignments", &id, "insert", user_id)?;
    enqueue_row(&tx, "tires", tire_id, "update", user_id)?;
    tx.commit()?;
    Ok(id)
}

/// Dismount the active assignment at a position; the tire moves to `to_status`.
pub fn tire_dismount(
    pool: &DbPool,
    assignment_id: &str,
    odometer: Option<i64>,
    reason: &str,
    to_status: &str,
    user_id: i64,
) -> AppResult<()> {
    if !["in_stock", "in_repair", "retreading", "scrapped"].contains(&to_status) {
        return Err(AppError::Internal(format!("invalid destination status: {to_status}")));
    }
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();

    let tire_id: Option<String> = tx
        .query_row(
            "SELECT tire_id FROM tire_assignments
              WHERE id=?1 AND dismounted_at IS NULL AND deleted_at IS NULL",
            params![assignment_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(tire_id) = tire_id else {
        return Err(AppError::Internal("active assignment not found".into()));
    };

    tx.execute(
        "UPDATE tire_assignments SET dismounted_at=?2, dismounted_odometer=?3,
            dismount_reason=?4, updated_at=?2, updated_by_user_id=?5
          WHERE id=?1",
        params![assignment_id, now, odometer, reason, user_id],
    )?;
    tx.execute(
        "UPDATE tires SET status=?2,
            scrap_date = CASE WHEN ?2='scrapped' THEN ?3 ELSE scrap_date END,
            updated_at=?3, updated_by_user_id=?4
          WHERE id=?1",
        params![tire_id, to_status, now, user_id],
    )?;

    enqueue_row(&tx, "tire_assignments", assignment_id, "update", user_id)?;
    enqueue_row(&tx, "tires", &tire_id, "update", user_id)?;
    tx.commit()?;
    Ok(())
}

// ═════════════════════════════ chassis ═══════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct ChassisConfig {
    pub drive_axles: i64,   // tractor axles behind the steering axle
    pub trailer_axles: i64,
    pub spares: i64,
    pub single_trailer_axles: Option<bool>,
}

/// Create a layout + axles + positions for a vehicle in one shot, mirroring
/// maint-rust's chassis_builder codes exactly:
///   tractor single: H{n}L/H{n}R · dual: H{n}LO/LI/RI/RO · trailer: TR{n}… · spare: SP{n}
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

    let layout_id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO chassis_layouts
           (id, vehicle_id, name_ar, name_en, created_at, updated_at,
            created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?4,?5,?5,?6,?6,1)",
        params![layout_id, vehicle_id, "الشاسيه", "Chassis", now, user_id],
    )?;
    enqueue_row(&tx, "chassis_layouts", &layout_id, "insert", user_id)?;

    let add_axle = |section: &str, idx: i64, axle_type: &str, steering: bool| -> AppResult<String> {
        let id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO chassis_axles
               (id, layout_id, section, section_index, axle_type, is_steering, is_lifted,
                created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
             VALUES (?1,?2,?3,?4,?5,?6,0,?7,?7,?8,?8,1)",
            params![id, layout_id, section, idx, axle_type, steering as i64, now, user_id],
        )?;
        enqueue_row(&tx, "chassis_axles", &id, "insert", user_id)?;
        Ok(id)
    };

    let mut positions: Vec<(String, Option<String>, Option<&str>, Option<&str>, bool, Option<i64>, String)> = Vec::new();

    // Steering axle (single) + drive axles (dual).
    let steer = add_axle("tractor", 1, "single", true)?;
    positions.push((Uuid::new_v4().to_string(), Some(steer.clone()), Some("left"), Some("single"), false, None, "H1L".into()));
    positions.push((Uuid::new_v4().to_string(), Some(steer), Some("right"), Some("single"), false, None, "H1R".into()));
    for i in 0..cfg.drive_axles {
        let n = i + 2;
        let id = add_axle("tractor", n, "dual", false)?;
        for (side, depth, suffix) in
            [("left", "outer", "LO"), ("left", "inner", "LI"), ("right", "inner", "RI"), ("right", "outer", "RO")]
        {
            positions.push((
                Uuid::new_v4().to_string(),
                Some(id.clone()),
                Some(side),
                Some(depth),
                false,
                None,
                format!("H{n}{suffix}"),
            ));
        }
    }
    let single_trailer = cfg.single_trailer_axles.unwrap_or(false);
    for i in 0..cfg.trailer_axles {
        let n = i + 1;
        let axle_type = if single_trailer { "single" } else { "dual" };
        let id = add_axle("trailer", n, axle_type, false)?;
        if single_trailer {
            positions.push((Uuid::new_v4().to_string(), Some(id.clone()), Some("left"), Some("single"), false, None, format!("TR{n}L")));
            positions.push((Uuid::new_v4().to_string(), Some(id), Some("right"), Some("single"), false, None, format!("TR{n}R")));
        } else {
            for (side, depth, suffix) in
                [("left", "outer", "LO"), ("left", "inner", "LI"), ("right", "inner", "RI"), ("right", "outer", "RO")]
            {
                positions.push((
                    Uuid::new_v4().to_string(),
                    Some(id.clone()),
                    Some(side),
                    Some(depth),
                    false,
                    None,
                    format!("TR{n}{suffix}"),
                ));
            }
        }
    }
    for s in 1..=cfg.spares {
        positions.push((Uuid::new_v4().to_string(), None, None, None, true, Some(s), format!("SP{s}")));
    }

    for (id, axle_id, side, depth, is_spare, spare_index, code) in &positions {
        tx.execute(
            "INSERT INTO chassis_positions
               (id, layout_id, axle_id, side, depth, is_spare, spare_index, position_code,
                created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,?10,?10,1)",
            params![id, layout_id, axle_id, side, depth, *is_spare as i64, spare_index, code, now, user_id],
        )?;
        enqueue_row(&tx, "chassis_positions", id, "insert", user_id)?;
    }

    tx.commit()?;
    Ok(layout_id)
}

// ═════════════════════════════ reads ═════════════════════════════════════════

/// The local mirror of v_maintenance_due — including the 0011 odometer-truth
/// resolution: current odometer = MAX over every observation we hold (Falcon
/// mileage, Falcon fuel, manual override, highest service reading), with the
/// winning source + its observation time exposed so staleness is visible.
pub const DUE_SQL: &str = "
WITH readings(vehicle_id, reading, src, observed_at) AS (
    SELECT id, COALESCE(mileage, 0), 'falcon_mileage', fetched_at FROM vehicles_cache
    UNION ALL
    SELECT id, COALESCE(last_fuel_odometer, 0), 'falcon_fuel', fetched_at FROM vehicles_cache
    UNION ALL
    SELECT vehicle_id, odometer, 'manual', set_at FROM vehicle_odometer_overrides
    UNION ALL
    SELECT vehicle_id, MAX(odometer_at_service), 'service', MAX(performed_at)
      FROM maintenance_records
     WHERE deleted_at IS NULL AND odometer_at_service IS NOT NULL
     GROUP BY vehicle_id
),
best AS (
    SELECT vehicle_id, reading AS current_odometer, src AS odometer_source,
           observed_at AS odometer_observed_at
      FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY vehicle_id ORDER BY reading DESC) rn
              FROM readings)
     WHERE rn = 1
),
latest AS (
    SELECT r.* FROM maintenance_records r
     WHERE r.deleted_at IS NULL
       AND r.id = (SELECT id FROM maintenance_records
                    WHERE template_id = r.template_id AND deleted_at IS NULL
                    ORDER BY performed_at DESC LIMIT 1)
)
SELECT
    t.id                AS template_id,
    t.vehicle_id,
    v.car_no_plate      AS plate_number,
    t.category_id,
    c.icon              AS category_icon,
    t.name_ar, t.name_en,
    t.trigger_type,
    t.interval_km, t.interval_days,
    r.performed_at      AS last_done_at,
    r.odometer_at_service AS last_done_km,
    r.next_due_at, r.next_due_km,
    COALESCE(b.current_odometer, 0)     AS current_odometer,
    COALESCE(b.odometer_source, 'none') AS odometer_source,
    b.odometer_observed_at,
    CASE
      WHEN r.id IS NULL THEN 'never_done'
      WHEN t.trigger_type = 'mileage' AND r.next_due_km IS NOT NULL THEN
        CASE
          WHEN COALESCE(b.current_odometer,0) >= r.next_due_km THEN 'overdue'
          WHEN COALESCE(b.current_odometer,0) >= r.next_due_km - t.lead_warn_km THEN 'due_soon'
          ELSE 'ok'
        END
      WHEN t.trigger_type = 'time' AND r.next_due_at IS NOT NULL THEN
        CASE
          WHEN datetime('now') >= datetime(r.next_due_at) THEN 'overdue'
          WHEN datetime('now') >= datetime(r.next_due_at, '-' || t.lead_warn_days || ' days') THEN 'due_soon'
          ELSE 'ok'
        END
      ELSE 'never_done'
    END AS status
FROM maintenance_templates t
JOIN vehicles_cache v ON v.id = t.vehicle_id AND v.source_deleted_at IS NULL
JOIN maintenance_categories c ON c.id = t.category_id
LEFT JOIN best b ON b.vehicle_id = t.vehicle_id
LEFT JOIN latest r ON r.template_id = t.id
WHERE t.deleted_at IS NULL AND t.is_active = 1
";

#[derive(Debug, Clone, Serialize)]
pub struct DueItem {
    pub template_id: String,
    pub vehicle_id: i64,
    pub plate_number: String,
    pub category_id: String,
    pub category_icon: Option<String>,
    pub name_ar: String,
    pub name_en: String,
    pub trigger_type: String,
    pub interval_km: Option<i64>,
    pub interval_days: Option<i64>,
    pub last_done_at: Option<String>,
    pub last_done_km: Option<i64>,
    pub next_due_at: Option<String>,
    pub next_due_km: Option<i64>,
    pub current_odometer: i64,
    pub odometer_source: String,
    pub odometer_observed_at: Option<String>,
    pub status: String,
}

pub fn due_list(pool: &DbPool, vehicle_id: Option<i64>) -> AppResult<Vec<DueItem>> {
    let conn = pool.get()?;
    let sql = match vehicle_id {
        Some(_) => format!("{DUE_SQL} AND t.vehicle_id = ?1"),
        None => DUE_SQL.to_string(),
    };
    let mut stmt = conn.prepare(&sql)?;
    let map = |r: &rusqlite::Row<'_>| -> rusqlite::Result<DueItem> {
        Ok(DueItem {
            template_id: r.get("template_id")?,
            vehicle_id: r.get("vehicle_id")?,
            plate_number: r.get("plate_number")?,
            category_id: r.get("category_id")?,
            category_icon: r.get("category_icon")?,
            name_ar: r.get("name_ar")?,
            name_en: r.get("name_en")?,
            trigger_type: r.get("trigger_type")?,
            interval_km: r.get("interval_km")?,
            interval_days: r.get("interval_days")?,
            last_done_at: r.get("last_done_at")?,
            last_done_km: r.get("last_done_km")?,
            next_due_at: r.get("next_due_at")?,
            next_due_km: r.get("next_due_km")?,
            current_odometer: r.get("current_odometer")?,
            odometer_source: r.get("odometer_source")?,
            odometer_observed_at: r.get("odometer_observed_at")?,
            status: r.get("status")?,
        })
    };
    let rows = match vehicle_id {
        Some(vid) => stmt.query_map(params![vid], map)?.collect::<Result<Vec<_>, _>>()?,
        None => stmt.query_map([], map)?.collect::<Result<Vec<_>, _>>()?,
    };
    Ok(rows)
}

/// Generic list reads, returned as raw JSON rows (the frontend types them).
pub fn rows_json(pool: &DbPool, sql: &str, args: &[&dyn rusqlite::types::ToSql]) -> AppResult<Vec<Value>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(sql)?;
    let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt
        .query_map(args, |r| {
            let mut obj = serde_json::Map::new();
            for (i, name) in col_names.iter().enumerate() {
                let v = match r.get_ref(i)? {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(n) => json!(n),
                    rusqlite::types::ValueRef::Real(f) => json!(f),
                    rusqlite::types::ValueRef::Text(t) => {
                        let s = String::from_utf8_lossy(t).to_string();
                        if name == "attachments" {
                            serde_json::from_str(&s).unwrap_or(Value::String(s))
                        } else {
                            Value::String(s)
                        }
                    }
                    rusqlite::types::ValueRef::Blob(_) => Value::Null,
                };
                obj.insert(name.clone(), v);
            }
            Ok(Value::Object(obj))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pool() -> DbPool {
        let dir = std::env::temp_dir().join(format!("apex-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = DbPool::open(&dir.join("t.db")).unwrap();
        p.run_migrations().unwrap();
        p
    }

    fn seed_vehicle(pool: &DbPool, id: i64, fuel: i64, mileage: Option<i64>) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO vehicles_cache (id, car_no_plate, last_fuel_odometer, mileage, raw_payload, fetched_at)
             VALUES (?1, 'T '||?1, ?2, ?3, '{}', ?4)",
            params![id, fuel, mileage, now_iso()],
        )
        .unwrap();
    }

    #[test]
    fn record_create_resets_the_template_clock() {
        let p = pool();
        seed_vehicle(&p, 901, 480_000, None);
        let tid = template_create(
            &p,
            &TemplateInput {
                vehicle_id: 901,
                category_id: "oil_change".into(),
                name_ar: "زيت".into(),
                name_en: "Oil".into(),
                notes_ar: None,
                notes_en: None,
                trigger_type: "mileage".into(),
                interval_km: Some(10_000),
                interval_days: None,
                lead_warn_km: None,
                lead_warn_days: None,
            },
            1,
        )
        .unwrap();
        record_create(
            &p,
            &RecordInput {
                template_id: Some(tid),
                vehicle_id: 901,
                category_id: "oil_change".into(),
                performed_at: "2026-07-01T10:00:00Z".into(),
                odometer_at_service: Some(486_320),
                cost: Some(1500.0),
                vendor: None,
                performed_by: None,
                notes: None,
            },
            1,
        )
        .unwrap();
        let due = due_list(&p, Some(901)).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].next_due_km, Some(496_320));
        // Odometer truth: the service reading (486,320) beats the fuel reading.
        assert_eq!(due[0].current_odometer, 486_320);
        assert_eq!(due[0].odometer_source, "service");
        assert_eq!(due[0].status, "ok");
    }

    #[test]
    fn due_flips_overdue_when_service_reading_passes_next_due() {
        let p = pool();
        seed_vehicle(&p, 902, 480_000, Some(481_000));
        let tid = template_create(
            &p,
            &TemplateInput {
                vehicle_id: 902,
                category_id: "oil_change".into(),
                name_ar: "زيت".into(),
                name_en: "Oil".into(),
                notes_ar: None,
                notes_en: None,
                trigger_type: "mileage".into(),
                interval_km: Some(5_000),
                interval_days: None,
                lead_warn_km: None,
                lead_warn_days: None,
            },
            1,
        )
        .unwrap();
        // Old service at 480k → next due 485k. Then a NEWER record at 490k on
        // another template? No — same template resets the clock. Instead the
        // override pushes the current reading past due.
        record_create(
            &p,
            &RecordInput {
                template_id: Some(tid),
                vehicle_id: 902,
                category_id: "oil_change".into(),
                performed_at: "2026-06-01T10:00:00Z".into(),
                odometer_at_service: Some(480_000),
                cost: None,
                vendor: None,
                performed_by: None,
                notes: None,
            },
            1,
        )
        .unwrap();
        override_set(&p, 902, 486_000, Some("dashboard reading"), 1).unwrap();
        let due = due_list(&p, Some(902)).unwrap();
        assert_eq!(due[0].current_odometer, 486_000);
        assert_eq!(due[0].odometer_source, "manual");
        assert_eq!(due[0].status, "overdue");
    }

    #[test]
    fn mount_dismount_roundtrip_enqueues_everything() {
        let p = pool();
        seed_vehicle(&p, 903, 100_000, None);
        let layout = chassis_create(
            &p,
            903,
            &ChassisConfig { drive_axles: 2, trailer_axles: 4, spares: 2, single_trailer_axles: None },
            1,
        )
        .unwrap();
        assert!(!layout.is_empty());

        let conn = p.get().unwrap();
        // 2 (steer) + 2×4 (drive) + 4×4 (trailer) + 2 spares = 28 positions.
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM chassis_positions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 28);
        let h2lo: String = conn
            .query_row(
                "SELECT id FROM chassis_positions WHERE position_code = 'H2LO'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        drop(conn);

        let tire = tire_create(
            &p,
            &TireInput {
                dot_code: "DOT TEST 1".into(),
                brand: "Michelin".into(),
                model: None,
                purchase_date: None,
                purchase_cost: None,
                supplier: None,
                is_retread: None,
                stock_location: None,
                notes: None,
            },
            1,
        )
        .unwrap();
        let asg = tire_mount(&p, &tire, &h2lo, 903, Some(100_000), "new_install", 1).unwrap();

        // Second mount on the same position must fail (partial unique index).
        let tire2 = tire_create(
            &p,
            &TireInput {
                dot_code: "DOT TEST 2".into(),
                brand: "Goodyear".into(),
                model: None,
                purchase_date: None,
                purchase_cost: None,
                supplier: None,
                is_retread: None,
                stock_location: None,
                notes: None,
            },
            1,
        )
        .unwrap();
        assert!(tire_mount(&p, &tire2, &h2lo, 903, None, "new_install", 1).is_err());

        tire_dismount(&p, &asg, Some(130_000), "wear", "scrapped", 1).unwrap();
        let conn = p.get().unwrap();
        let status: String = conn
            .query_row("SELECT status FROM tires WHERE id=?1", params![tire], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "scrapped");

        // Everything above must be queued for the server.
        let counts = crate::services::outbox::counts(&conn).unwrap();
        assert!(counts.pending >= 30, "layout + axles + positions + tires + assignment all enqueued, got {}", counts.pending);
    }

    #[test]
    fn outbox_payload_booleans_are_real_json_booleans() {
        let p = pool();
        seed_vehicle(&p, 904, 0, None);
        template_create(
            &p,
            &TemplateInput {
                vehicle_id: 904,
                category_id: "oil_change".into(),
                name_ar: "x".into(),
                name_en: "x".into(),
                notes_ar: None,
                notes_en: None,
                trigger_type: "time".into(),
                interval_km: None,
                interval_days: Some(90),
                lead_warn_km: None,
                lead_warn_days: None,
            },
            1,
        )
        .unwrap();
        let conn = p.get().unwrap();
        let payload: String = conn
            .query_row(
                "SELECT payload FROM outbox WHERE entity_type='maintenance_templates'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let v: Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(v.get("is_active"), Some(&Value::Bool(true)), "0/1 → true/false for the server");
    }
}
