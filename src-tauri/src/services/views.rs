//! Owned-domain READS: typed view-models over the local database.
//!
//! Every screen reads from here — local SQLite is the working truth (mirror ∪
//! local intent, since writes land locally in the same transaction that queues
//! them). Rows that haven't been server-acked yet are surfaced via `pending`
//! flags computed from the outbox, so queued work is visible AS queued.
//!
//! Derived values (grouping, counts, status math, odometer truth) live in SQL
//! or Rust here — never in React.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::db::DbPool;
use crate::services::outbox;
use crate::AppResult;

/// Normalize Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits to
/// ASCII so a mechanic typing ٨٣٥١ finds plate "… 8351".
pub fn normalize_digits(q: &str) -> String {
    q.chars()
        .map(|c| match c {
            '\u{0660}'..='\u{0669}' => char::from(b'0' + (c as u32 - 0x0660) as u8),
            '\u{06F0}'..='\u{06F9}' => char::from(b'0' + (c as u32 - 0x06F0) as u8),
            _ => c,
        })
        .collect()
}

fn pending_ids(conn: &Connection, entity: &str) -> AppResult<HashSet<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT entity_id FROM outbox
          WHERE entity_type = ?1 AND status IN ('pending','inflight','dead')",
    )?;
    let ids = stmt
        .query_map(params![entity], |r| r.get::<_, String>(0))?
        .collect::<Result<HashSet<_>, _>>()?;
    Ok(ids)
}

// ═════════════════════════════ odometer truth ════════════════════════════════

/// Mirrors maint-rust v_current_odometer (0014). A manual override is an
/// explicit human correction, not one more reading competing by MAX:
///  * oil/WO readings recorded BEFORE the correction are discarded;
///  * the Falcon fuel reading is discarded while it is ≤ the value it showed
///    when the correction was made (superseded_km);
///  * everything observed after the correction competes by MAX as usual.
const ODO_CTE: &str = "
readings(vehicle_id, km, src, observed_at) AS (
    SELECT v.id, v.last_fuel_odometer, 'falcon_fuel', v.fetched_at
      FROM vehicles_cache v
      LEFT JOIN vehicle_odometer_overrides ovf
             ON ovf.vehicle_id = v.id AND ovf.odometer IS NOT NULL
     WHERE v.last_fuel_odometer IS NOT NULL AND v.last_fuel_odometer > 0
       AND (ovf.vehicle_id IS NULL OR v.last_fuel_odometer > COALESCE(ovf.superseded_km, -1))
    UNION ALL
    SELECT o.vehicle_id, o.odometer, 'oil_change', o.performed_at
      FROM oil_changes o
      LEFT JOIN vehicle_odometer_overrides ovo
             ON ovo.vehicle_id = o.vehicle_id AND ovo.odometer IS NOT NULL
     WHERE o.deleted_at IS NULL AND o.odometer IS NOT NULL
       AND (ovo.vehicle_id IS NULL OR julianday(o.performed_at) >= julianday(ovo.set_at))
    UNION ALL
    SELECT w.vehicle_id, w.odometer_at_open, 'work_order', w.opened_at
      FROM work_orders w
      LEFT JOIN vehicle_odometer_overrides ovw
             ON ovw.vehicle_id = w.vehicle_id AND ovw.odometer IS NOT NULL
     WHERE w.deleted_at IS NULL AND w.odometer_at_open IS NOT NULL
       AND (ovw.vehicle_id IS NULL OR julianday(w.opened_at) >= julianday(ovw.set_at))
    UNION ALL
    SELECT vehicle_id, odometer, 'manual_override', set_at
      FROM vehicle_odometer_overrides WHERE odometer IS NOT NULL
),
odo AS (
    SELECT vehicle_id, km AS current_odometer, src AS odometer_source,
           observed_at AS odometer_observed_at
      FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY vehicle_id ORDER BY km DESC) rn
              FROM readings)
     WHERE rn = 1
)";

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct OdoTruth {
    pub km: i64,
    pub source: String,
    pub observed_at: Option<String>,
}

pub fn odometer_truth(pool: &DbPool, vehicle_id: i64) -> AppResult<Option<OdoTruth>> {
    let conn = pool.get()?;
    let sql = format!(
        "WITH {ODO_CTE}
         SELECT current_odometer, odometer_source, odometer_observed_at
           FROM odo WHERE vehicle_id = ?1"
    );
    let v = conn
        .query_row(&sql, params![vehicle_id], |r| {
            Ok(OdoTruth { km: r.get(0)?, source: r.get(1)?, observed_at: r.get(2)? })
        })
        .optional()?;
    Ok(v)
}

// ═════════════════════════════ due ═══════════════════════════════════════════

/// Local mirror of maint-rust v_maintenance_due (plans × class assignments,
/// last-done from categorized work-order tasks, odometer truth).
/// Time comparisons go through julianday() because pulled rows carry Postgres
/// timestamp formatting while local writes carry RFC3339-Z — lexical compare
/// across the two lies.
const DUE_TAIL: &str = "
last_done AS (
    SELECT wo.vehicle_id, t.category_id,
           MAX(wo.opened_at)        AS last_at,
           MAX(wo.odometer_at_open) AS last_km
      FROM work_order_tasks t
      JOIN work_orders wo ON wo.id = t.work_order_id
     WHERE t.deleted_at IS NULL AND wo.deleted_at IS NULL AND t.category_id IS NOT NULL
     GROUP BY wo.vehicle_id, t.category_id
)
SELECT
    vca.vehicle_id,
    v.car_no_plate                            AS plate,
    sp.id                                     AS plan_id,
    sp.category_id,
    c.name_ar                                 AS category_name_ar,
    c.name_en                                 AS category_name_en,
    sp.trigger_type,
    sp.interval_km,
    sp.interval_days,
    ld.last_at,
    ld.last_km,
    CASE WHEN sp.trigger_type = 'mileage' THEN ld.last_km + sp.interval_km END AS next_due_km,
    CASE WHEN sp.trigger_type = 'time' AND ld.last_at IS NOT NULL
         THEN datetime(julianday(ld.last_at) + sp.interval_days) END           AS next_due_at,
    odo.current_odometer,
    odo.odometer_source,
    odo.odometer_observed_at,
    CASE
        WHEN ld.last_at IS NULL THEN 'never_done'
        WHEN sp.trigger_type = 'mileage' THEN
            CASE
                WHEN odo.current_odometer IS NULL THEN 'ok'
                WHEN odo.current_odometer >= ld.last_km + sp.interval_km THEN 'overdue'
                WHEN odo.current_odometer >= ld.last_km + sp.interval_km - COALESCE(sp.lead_warn_km,500) THEN 'due_soon'
                ELSE 'ok'
            END
        ELSE
            CASE
                WHEN julianday('now') >= julianday(ld.last_at) + sp.interval_days THEN 'overdue'
                WHEN julianday('now') >= julianday(ld.last_at) + sp.interval_days - COALESCE(sp.lead_warn_days,14) THEN 'due_soon'
                ELSE 'ok'
            END
    END AS status
FROM vehicle_class_assignments vca
JOIN service_plans sp ON sp.class_id = vca.class_id AND sp.is_active = 1 AND sp.deleted_at IS NULL
JOIN maintenance_categories c ON c.id = sp.category_id
JOIN vehicles_cache v ON v.id = vca.vehicle_id AND v.source_deleted_at IS NULL
LEFT JOIN last_done ld ON ld.vehicle_id = vca.vehicle_id AND ld.category_id = sp.category_id
LEFT JOIN odo ON odo.vehicle_id = vca.vehicle_id
WHERE vca.deleted_at IS NULL
";

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DueRow {
    pub vehicle_id: i64,
    pub plate: String,
    pub plan_id: String,
    pub category_id: String,
    pub category_name_ar: String,
    pub category_name_en: String,
    pub trigger_type: String,
    pub interval_km: Option<i64>,
    pub interval_days: Option<i64>,
    pub last_at: Option<String>,
    pub last_km: Option<i64>,
    pub next_due_km: Option<i64>,
    pub next_due_at: Option<String>,
    pub current_odometer: Option<i64>,
    pub odometer_source: Option<String>,
    pub odometer_observed_at: Option<String>,
    pub status: String,
}

fn map_due(r: &rusqlite::Row<'_>) -> rusqlite::Result<DueRow> {
    Ok(DueRow {
        vehicle_id: r.get("vehicle_id")?,
        plate: r.get("plate")?,
        plan_id: r.get("plan_id")?,
        category_id: r.get("category_id")?,
        category_name_ar: r.get("category_name_ar")?,
        category_name_en: r.get("category_name_en")?,
        trigger_type: r.get("trigger_type")?,
        interval_km: r.get("interval_km")?,
        interval_days: r.get("interval_days")?,
        last_at: r.get("last_at")?,
        last_km: r.get("last_km")?,
        next_due_km: r.get("next_due_km")?,
        next_due_at: r.get("next_due_at")?,
        current_odometer: r.get("current_odometer")?,
        odometer_source: r.get("odometer_source")?,
        odometer_observed_at: r.get("odometer_observed_at")?,
        status: r.get("status")?,
    })
}

pub fn due_board(pool: &DbPool, vehicle_id: Option<i64>) -> AppResult<Vec<DueRow>> {
    let conn = pool.get()?;
    let order = " ORDER BY CASE status WHEN 'overdue' THEN 0 WHEN 'never_done' THEN 1 WHEN 'due_soon' THEN 2 ELSE 3 END, plate";
    let due_sql = format!("WITH {ODO_CTE}, {DUE_TAIL}");
    let mut rows = match vehicle_id {
        Some(vid) => {
            let sql = format!("SELECT * FROM ({due_sql}) WHERE vehicle_id = ?1 {order}");
            let mut stmt = conn.prepare(&sql)?;
            let v = stmt.query_map(params![vid], map_due)?.collect::<Result<Vec<_>, _>>()?;
            v
        }
        None => {
            let sql = format!("SELECT * FROM ({due_sql}) {order}");
            let mut stmt = conn.prepare(&sql)?;
            let v = stmt.query_map([], map_due)?.collect::<Result<Vec<_>, _>>()?;
            v
        }
    };
    // Deterministic secondary ordering for identical (status, plate).
    rows.sort_by(|a, b| {
        let rank = |s: &str| match s {
            "overdue" => 0,
            "never_done" => 1,
            "due_soon" => 2,
            _ => 3,
        };
        rank(&a.status).cmp(&rank(&b.status)).then_with(|| a.plate.cmp(&b.plate))
    });
    Ok(rows)
}

// ═════════════════════════════ work orders ═══════════════════════════════════

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct WoListRow {
    pub id: String,
    pub vehicle_id: i64,
    pub plate: String,
    pub title: Option<String>,
    pub status: String,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub odometer_at_open: Option<i64>,
    pub task_count: i64,
    pub opened_by_user_id: i64,
    /// True while any part of this WO is still queued/unacked in the outbox.
    pub pending: bool,
}

fn map_wo_list(r: &rusqlite::Row<'_>) -> rusqlite::Result<WoListRow> {
    Ok(WoListRow {
        id: r.get("id")?,
        vehicle_id: r.get("vehicle_id")?,
        plate: r.get("plate")?,
        title: r.get("title")?,
        status: r.get("status")?,
        opened_at: r.get("opened_at")?,
        closed_at: r.get("closed_at")?,
        odometer_at_open: r.get("odometer_at_open")?,
        task_count: r.get("task_count")?,
        opened_by_user_id: r.get("opened_by_user_id")?,
        pending: false,
    })
}

const WO_LIST_SQL: &str = "
SELECT wo.id, wo.vehicle_id, COALESCE(v.car_no_plate, '#' || wo.vehicle_id) AS plate,
       wo.title, wo.status, wo.opened_at, wo.closed_at, wo.odometer_at_open,
       wo.created_by_user_id AS opened_by_user_id,
       (SELECT COUNT(*) FROM work_order_tasks t
         WHERE t.work_order_id = wo.id AND t.deleted_at IS NULL) AS task_count
  FROM work_orders wo
  LEFT JOIN vehicles_cache v ON v.id = wo.vehicle_id
 WHERE wo.deleted_at IS NULL
";

pub fn wo_list(
    pool: &DbPool,
    status: Option<&str>,
    vehicle_id: Option<i64>,
) -> AppResult<Vec<WoListRow>> {
    let conn = pool.get()?;
    let mut sql = WO_LIST_SQL.to_string();
    if status.is_some() {
        sql.push_str(" AND wo.status = ?1");
    }
    if vehicle_id.is_some() {
        sql.push_str(if status.is_some() { " AND wo.vehicle_id = ?2" } else { " AND wo.vehicle_id = ?1" });
    }
    sql.push_str(" ORDER BY julianday(wo.opened_at) DESC");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = match (status, vehicle_id) {
        (Some(s), Some(v)) => stmt.query_map(params![s, v], map_wo_list)?.collect::<Result<Vec<_>, _>>()?,
        (Some(s), None) => stmt.query_map(params![s], map_wo_list)?.collect::<Result<Vec<_>, _>>()?,
        (None, Some(v)) => stmt.query_map(params![v], map_wo_list)?.collect::<Result<Vec<_>, _>>()?,
        (None, None) => stmt.query_map([], map_wo_list)?.collect::<Result<Vec<_>, _>>()?,
    };
    let pending_wos = pending_ids(&conn, "work_orders")?;
    for w in &mut rows {
        w.pending = pending_wos.contains(&w.id);
    }
    Ok(rows)
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct TaskRow {
    pub id: String,
    pub kind: String,
    pub category_id: Option<String>,
    pub category_name_ar: Option<String>,
    pub description_ar: Option<String>,
    pub created_at: String,
    pub pending: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct OilRow {
    pub id: String,
    pub oil_type: String,
    pub liters: f64,
    pub odometer: Option<i64>,
    pub flagged: bool,
    pub performed_at: String,
    pub pending: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct TireOpRow {
    pub assignment_id: String,
    pub tire_id: String,
    pub dot_code: Option<String>,
    pub brand: Option<String>,
    pub position_code: Option<String>,
    pub mounted_at: Option<String>,
    pub mounted_odometer: Option<i64>,
    pub mount_reason: Option<String>,
    pub dismounted_at: Option<String>,
    pub dismounted_odometer: Option<i64>,
    pub dismount_reason: Option<String>,
    pub pending: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct WoDetail {
    pub wo: WoListRow,
    pub sync_version: i64,
    pub tasks: Vec<TaskRow>,
    pub oil_changes: Vec<OilRow>,
    pub tire_ops: Vec<TireOpRow>,
    /// This truck's due items — the cockpit's suggestion panel.
    pub due: Vec<DueRow>,
    pub odometer: Option<OdoTruth>,
}

pub fn wo_detail(pool: &DbPool, id: &str) -> AppResult<Option<WoDetail>> {
    let conn = pool.get()?;
    let sql = format!("{WO_LIST_SQL} AND wo.id = ?1");
    let base = {
        let mut stmt = conn.prepare(&sql)?;
        stmt.query_row(params![id], map_wo_list).optional()?
    };
    let Some(mut wo) = base else { return Ok(None) };
    let pending_wos = pending_ids(&conn, "work_orders")?;
    wo.pending = pending_wos.contains(&wo.id);
    let sync_version: i64 = conn.query_row(
        "SELECT sync_version FROM work_orders WHERE id = ?1",
        params![id],
        |r| r.get(0),
    )?;

    let pending_tasks = pending_ids(&conn, "work_order_tasks")?;
    let mut stmt = conn.prepare(
        "SELECT t.id, t.kind, t.category_id, c.name_ar, t.description_ar, t.created_at
           FROM work_order_tasks t
           LEFT JOIN maintenance_categories c ON c.id = t.category_id
          WHERE t.work_order_id = ?1 AND t.deleted_at IS NULL
          ORDER BY t.sort_order, julianday(t.created_at)",
    )?;
    let tasks = stmt
        .query_map(params![id], |r| {
            Ok(TaskRow {
                id: r.get(0)?,
                kind: r.get(1)?,
                category_id: r.get(2)?,
                category_name_ar: r.get(3)?,
                description_ar: r.get(4)?,
                created_at: r.get(5)?,
                pending: false,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|mut t| {
            t.pending = pending_tasks.contains(&t.id);
            t
        })
        .collect();

    let pending_oil = pending_ids(&conn, "oil_changes")?;
    let mut stmt = conn.prepare(
        "SELECT id, oil_type, liters, odometer, flagged, performed_at
           FROM oil_changes WHERE work_order_id = ?1 AND deleted_at IS NULL
          ORDER BY julianday(performed_at)",
    )?;
    let oil_changes = stmt
        .query_map(params![id], |r| {
            Ok(OilRow {
                id: r.get(0)?,
                oil_type: r.get(1)?,
                liters: r.get(2)?,
                odometer: r.get(3)?,
                flagged: r.get::<_, i64>(4)? != 0,
                performed_at: r.get(5)?,
                pending: false,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|mut o| {
            o.pending = pending_oil.contains(&o.id);
            o
        })
        .collect();

    let tire_ops =
        tire_ops_for(&conn, "(ta.work_order_id = ?1 OR ta.dismount_work_order_id = ?1)", &[&id])?;
    let due = due_board(pool, Some(wo.vehicle_id))?;
    let odometer = odometer_truth(pool, wo.vehicle_id)?;

    Ok(Some(WoDetail { wo, sync_version, tasks, oil_changes, tire_ops, due, odometer }))
}

fn tire_ops_for(
    conn: &Connection,
    where_clause: &str,
    args: &[&dyn rusqlite::types::ToSql],
) -> AppResult<Vec<TireOpRow>> {
    let pending_asg = pending_ids(conn, "tire_assignments")?;
    let sql = format!(
        "SELECT ta.id, ta.tire_id, t.dot_code, t.brand, p.position_code,
                ta.mounted_at, ta.mounted_odometer, ta.mount_reason,
                ta.dismounted_at, ta.dismounted_odometer, ta.dismount_reason
           FROM tire_assignments ta
           LEFT JOIN tires t ON t.id = ta.tire_id
           LEFT JOIN chassis_positions p ON p.id = ta.position_id
          WHERE ta.deleted_at IS NULL AND {where_clause}
          ORDER BY julianday(ta.mounted_at)"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(args, |r| {
            Ok(TireOpRow {
                assignment_id: r.get(0)?,
                tire_id: r.get(1)?,
                dot_code: r.get(2)?,
                brand: r.get(3)?,
                position_code: r.get(4)?,
                mounted_at: r.get(5)?,
                mounted_odometer: r.get(6)?,
                mount_reason: r.get(7)?,
                dismounted_at: r.get(8)?,
                dismounted_odometer: r.get(9)?,
                dismount_reason: r.get(10)?,
                pending: false,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|mut t| {
            t.pending = pending_asg.contains(&t.assignment_id);
            t
        })
        .collect();
    Ok(rows)
}

// ═════════════════════════════ trucks ════════════════════════════════════════

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct TruckRow {
    pub id: i64,
    pub plate: String,
    pub car_type: Option<String>,
    pub class_id: Option<String>,
    pub class_name_ar: Option<String>,
    pub odometer: Option<OdoTruth>,
    pub open_wo_count: i64,
    pub overdue_count: i64,
    pub due_soon_count: i64,
    pub has_chassis: bool,
    pub driver_name: Option<String>,
}

pub fn truck_list(pool: &DbPool, q: Option<&str>) -> AppResult<Vec<TruckRow>> {
    let conn = pool.get()?;
    let sql = format!(
        "WITH {ODO_CTE}
         SELECT v.id, v.car_no_plate, v.car_type,
                vca.class_id, vc.name_ar AS class_name_ar,
                odo.current_odometer, odo.odometer_source, odo.odometer_observed_at,
                (SELECT COUNT(*) FROM work_orders wo
                  WHERE wo.vehicle_id = v.id AND wo.status='open' AND wo.deleted_at IS NULL) AS open_wo_count,
                (SELECT COUNT(*) FROM chassis_layouts cl
                  WHERE cl.vehicle_id = v.id AND cl.deleted_at IS NULL) AS has_chassis,
                d.name AS driver_name
           FROM vehicles_cache v
           LEFT JOIN vehicle_class_assignments vca ON vca.vehicle_id = v.id AND vca.deleted_at IS NULL
           LEFT JOIN vehicle_classes vc ON vc.id = vca.class_id
           LEFT JOIN drivers_cache d ON d.id = v.driver_id
           LEFT JOIN odo ON odo.vehicle_id = v.id
          WHERE v.source_deleted_at IS NULL
          ORDER BY v.car_no_plate"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows: Vec<TruckRow> = stmt
        .query_map([], |r| {
            let km: Option<i64> = r.get(5)?;
            Ok(TruckRow {
                id: r.get(0)?,
                plate: r.get(1)?,
                car_type: r.get(2)?,
                class_id: r.get(3)?,
                class_name_ar: r.get(4)?,
                odometer: km.map(|k| OdoTruth {
                    km: k,
                    source: r.get(6).unwrap_or_else(|_| "none".into()),
                    observed_at: r.get(7).ok(),
                }),
                open_wo_count: r.get(8)?,
                overdue_count: 0,
                due_soon_count: 0,
                has_chassis: r.get::<_, i64>(9)? > 0,
                driver_name: r.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Due badges from the same due query the board uses.
    let due = due_board(pool, None)?;
    for t in &mut rows {
        t.overdue_count = due
            .iter()
            .filter(|d| d.vehicle_id == t.id && (d.status == "overdue" || d.status == "never_done"))
            .count() as i64;
        t.due_soon_count =
            due.iter().filter(|d| d.vehicle_id == t.id && d.status == "due_soon").count() as i64;
    }

    if let Some(q) = q {
        let nq = normalize_digits(q.trim());
        if !nq.is_empty() {
            rows.retain(|t| t.plate.contains(&nq) || t.plate.replace(' ', "").contains(&nq));
        }
    }
    Ok(rows)
}

pub fn truck_file(pool: &DbPool, vehicle_id: i64) -> AppResult<Option<TruckRow>> {
    Ok(truck_list(pool, None)?.into_iter().find(|t| t.id == vehicle_id))
}

// ═════════════════════════════ home ══════════════════════════════════════════

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct StockTireLine {
    pub id: String,
    pub brand: String,
    pub model: Option<String>,
    pub size: Option<String>,
    pub snapshot_qty: i64,
    pub pending_debits: i64,
    pub projected_qty: i64,
    pub fetched_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct StockOilLine {
    pub id: String,
    pub oil_type: String,
    pub snapshot_liters: f64,
    pub pending_liters: f64,
    pub projected_liters: f64,
    pub fetched_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct StockView {
    pub tires: Vec<StockTireLine>,
    pub oil: Vec<StockOilLine>,
    /// Used tires available to mount (individual assets in the pool).
    pub used_pool_count: i64,
}

/// Projected on-hand = last server snapshot − debits still queued locally.
/// Queued oil debits = local oil_changes rows whose outbox op isn't acked;
/// queued tire debits = shipment-origin tire inserts not yet acked.
pub fn stock_view(pool: &DbPool) -> AppResult<StockView> {
    let conn = pool.get()?;
    let pending_oil = pending_ids(&conn, "oil_changes")?;
    let pending_tires = pending_ids(&conn, "tires")?;

    let mut stmt = conn.prepare(
        "SELECT id, brand, model, size, on_hand_qty, fetched_at FROM tire_stock_cache ORDER BY brand, model, size",
    )?;
    let mut tires: Vec<StockTireLine> = stmt
        .query_map([], |r| {
            Ok(StockTireLine {
                id: r.get(0)?,
                brand: r.get(1)?,
                model: r.get(2)?,
                size: r.get(3)?,
                snapshot_qty: r.get(4)?,
                pending_debits: 0,
                projected_qty: 0,
                fetched_at: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Count queued shipment-tire inserts per stock line.
    if !pending_tires.is_empty() {
        let mut stmt = conn.prepare(
            "SELECT brand, COALESCE(model,''), COALESCE(size,''), id FROM tires
              WHERE origin = 'shipment' AND deleted_at IS NULL",
        )?;
        let shipment_tires: Vec<(String, String, String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        for line in &mut tires {
            let lm = line.model.clone().unwrap_or_default();
            let ls = line.size.clone().unwrap_or_default();
            line.pending_debits = shipment_tires
                .iter()
                .filter(|(b, m, s, id)| {
                    *b == line.brand && *m == lm && *s == ls && pending_tires.contains(id)
                })
                .count() as i64;
        }
    }
    for line in &mut tires {
        line.projected_qty = line.snapshot_qty - line.pending_debits;
    }

    let mut stmt = conn.prepare(
        "SELECT id, oil_type, liters_on_hand, fetched_at FROM oil_stock_cache ORDER BY oil_type",
    )?;
    let mut oil: Vec<StockOilLine> = stmt
        .query_map([], |r| {
            Ok(StockOilLine {
                id: r.get(0)?,
                oil_type: r.get(1)?,
                snapshot_liters: r.get(2)?,
                pending_liters: 0.0,
                projected_liters: 0.0,
                fetched_at: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if !pending_oil.is_empty() {
        let mut stmt = conn.prepare(
            "SELECT oil_type, liters, id FROM oil_changes WHERE deleted_at IS NULL",
        )?;
        let ocs: Vec<(String, f64, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        for line in &mut oil {
            line.pending_liters = ocs
                .iter()
                .filter(|(t, _, id)| *t == line.oil_type && pending_oil.contains(id))
                .map(|(_, l, _)| *l)
                .sum();
        }
    }
    for line in &mut oil {
        line.projected_liters = line.snapshot_liters - line.pending_liters;
    }

    let used_pool_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tires WHERE status = 'in_stock_used' AND deleted_at IS NULL",
        [],
        |r| r.get(0),
    )?;

    Ok(StockView { tires, oil, used_pool_count })
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DueCounts {
    pub overdue: i64,
    pub never_done: i64,
    pub due_soon: i64,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct HomeSummary {
    pub open_wos: Vec<WoListRow>,
    /// Most urgent due rows (overdue + never_done), capped for the strip.
    pub attention: Vec<DueRow>,
    pub due_counts: DueCounts,
    pub low_stock_tires: Vec<StockTireLine>,
    pub low_stock_oil: Vec<StockOilLine>,
    pub sync_pending: i64,
    pub sync_dead: i64,
}

pub fn home_summary(pool: &DbPool) -> AppResult<HomeSummary> {
    let open_wos = wo_list(pool, Some("open"), None)?;
    let due = due_board(pool, None)?;
    let due_counts = DueCounts {
        overdue: due.iter().filter(|d| d.status == "overdue").count() as i64,
        never_done: due.iter().filter(|d| d.status == "never_done").count() as i64,
        due_soon: due.iter().filter(|d| d.status == "due_soon").count() as i64,
    };
    let attention: Vec<DueRow> = due
        .iter()
        .filter(|d| d.status == "overdue" || d.status == "due_soon")
        .take(8)
        .cloned()
        .collect();
    let stock = stock_view(pool)?;
    let low_stock_tires: Vec<StockTireLine> =
        stock.tires.into_iter().filter(|t| t.projected_qty <= 4).collect();
    let low_stock_oil: Vec<StockOilLine> =
        stock.oil.into_iter().filter(|o| o.projected_liters <= 72.0).collect();

    let conn = pool.get()?;
    let counts = outbox::counts(&conn)?;

    Ok(HomeSummary {
        open_wos,
        attention,
        due_counts,
        low_stock_tires,
        low_stock_oil,
        sync_pending: counts.pending,
        sync_dead: counts.dead,
    })
}

// ═════════════════════════════ tires ═════════════════════════════════════════

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct TireRow {
    pub id: String,
    pub dot_code: Option<String>,
    pub brand: String,
    pub model: Option<String>,
    pub size: Option<String>,
    pub status: String,
    pub origin: String,
    pub total_km: i64,
    pub retread_count: i64,
    pub mounted_vehicle_id: Option<i64>,
    pub mounted_plate: Option<String>,
    pub mounted_position_code: Option<String>,
    pub mounted_at: Option<String>,
    pub pending: bool,
}

pub fn tires_list(pool: &DbPool, status: Option<&str>, q: Option<&str>) -> AppResult<Vec<TireRow>> {
    let conn = pool.get()?;
    let pending = pending_ids(&conn, "tires")?;
    // Mounted tires show LIVE km: accrued total + the current run so far
    // (current odometer − mounted odometer), so a corrected odometer moves
    // the number immediately instead of waiting for the dismount accrual.
    let mut sql = format!(
        "WITH {ODO_CTE}
        SELECT t.id, t.dot_code, t.brand, t.model, t.size, t.status, t.origin,
               COALESCE(t.total_km,0)
                 + COALESCE((SELECT SUM(x.dismounted_odometer - x.mounted_odometer)
                       FROM tire_assignments x
                       LEFT JOIN chassis_positions xp ON xp.id = x.position_id
                      WHERE x.tire_id = t.id AND x.deleted_at IS NULL
                        AND x.dismounted_at IS NOT NULL
                        AND x.mounted_odometer IS NOT NULL AND x.dismounted_odometer IS NOT NULL
                        AND x.dismounted_odometer > x.mounted_odometer
                        AND COALESCE(xp.is_spare,0)=0), 0)
                 + CASE WHEN ta.id IS NOT NULL AND ta.mounted_odometer IS NOT NULL
                             AND COALESCE(p.is_spare,0)=0
                             AND odo.current_odometer > ta.mounted_odometer
                        THEN odo.current_odometer - ta.mounted_odometer ELSE 0 END,
               COALESCE(t.retread_count,0),
               ta.vehicle_id, v.car_no_plate, p.position_code, ta.mounted_at
          FROM tires t
          LEFT JOIN tire_assignments ta ON ta.tire_id = t.id AND ta.dismounted_at IS NULL AND ta.deleted_at IS NULL
          LEFT JOIN chassis_positions p ON p.id = ta.position_id
          LEFT JOIN vehicles_cache v ON v.id = ta.vehicle_id
          LEFT JOIN odo ON odo.vehicle_id = ta.vehicle_id
         WHERE t.deleted_at IS NULL"
    );
    if status.is_some() {
        sql.push_str(" AND t.status = ?1");
    }
    sql.push_str(" ORDER BY julianday(t.updated_at) DESC");
    let mut stmt = conn.prepare(&sql)?;
    let map = |r: &rusqlite::Row<'_>| -> rusqlite::Result<TireRow> {
        Ok(TireRow {
            id: r.get(0)?,
            dot_code: r.get(1)?,
            brand: r.get(2)?,
            model: r.get(3)?,
            size: r.get(4)?,
            status: r.get(5)?,
            origin: r.get(6)?,
            total_km: r.get(7)?,
            retread_count: r.get(8)?,
            mounted_vehicle_id: r.get(9)?,
            mounted_plate: r.get(10)?,
            mounted_position_code: r.get(11)?,
            mounted_at: r.get(12)?,
            pending: false,
        })
    };
    let mut rows = match status {
        Some(s) => stmt.query_map(params![s], map)?.collect::<Result<Vec<_>, _>>()?,
        None => stmt.query_map([], map)?.collect::<Result<Vec<_>, _>>()?,
    };
    for t in &mut rows {
        t.pending = pending.contains(&t.id);
    }
    if let Some(q) = q {
        let nq = normalize_digits(q.trim()).to_uppercase();
        if !nq.is_empty() {
            rows.retain(|t| {
                t.dot_code.as_deref().map(|d| d.to_uppercase().contains(&nq)).unwrap_or(false)
                    || t.brand.to_uppercase().contains(&nq)
            });
        }
    }
    Ok(rows)
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct TireEventRow {
    pub id: String,
    pub event_type: String,
    pub from_status: Option<String>,
    pub to_status: Option<String>,
    pub notes: Option<String>,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct TireFile {
    pub tire: TireRow,
    pub mounts: Vec<TireOpRow>,
    pub events: Vec<TireEventRow>,
}

pub fn tire_file(pool: &DbPool, id: &str) -> AppResult<Option<TireFile>> {
    let tire = tires_list(pool, None, None)?.into_iter().find(|t| t.id == id);
    let Some(tire) = tire else { return Ok(None) };
    let conn = pool.get()?;
    let mounts = tire_ops_for(&conn, "ta.tire_id = ?1", &[&id])?;
    let mut stmt = conn.prepare(
        "SELECT id, event_type, from_status, to_status, notes, occurred_at
           FROM tire_status_events WHERE tire_id = ?1 AND deleted_at IS NULL
          ORDER BY julianday(occurred_at) DESC",
    )?;
    let events = stmt
        .query_map(params![id], |r| {
            Ok(TireEventRow {
                id: r.get(0)?,
                event_type: r.get(1)?,
                from_status: r.get(2)?,
                to_status: r.get(3)?,
                notes: r.get(4)?,
                occurred_at: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(TireFile { tire, mounts, events }))
}

// ═════════════════════════════ chassis ═══════════════════════════════════════

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AxleRow {
    pub id: String,
    pub section: String,
    pub section_index: i64,
    pub axle_type: String,
    pub is_steering: bool,
    pub is_lifted: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PositionRow {
    pub id: String,
    pub axle_id: Option<String>,
    pub side: Option<String>,
    pub depth: Option<String>,
    pub is_spare: bool,
    pub spare_index: Option<i64>,
    pub position_code: String,
    // Current mount (if any):
    pub assignment_id: Option<String>,
    pub tire_id: Option<String>,
    pub dot_code: Option<String>,
    pub brand: Option<String>,
    pub model: Option<String>,
    pub size: Option<String>,
    pub origin: Option<String>,
    pub retread_count: Option<i64>,
    pub mount_reason: Option<String>,
    pub tire_status: Option<String>,
    pub mounted_at: Option<String>,
    pub mounted_odometer: Option<i64>,
    pub total_km: Option<i64>,
    /// The mount/dismount for this position is still queued/unacked.
    pub pending: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct ChassisPayload {
    pub layout_id: String,
    pub axles: Vec<AxleRow>,
    pub positions: Vec<PositionRow>,
}

pub fn chassis_get(pool: &DbPool, vehicle_id: i64) -> AppResult<Option<ChassisPayload>> {
    let conn = pool.get()?;
    let layout_id: Option<String> = conn
        .query_row(
            "SELECT id FROM chassis_layouts WHERE vehicle_id=?1 AND deleted_at IS NULL",
            params![vehicle_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(layout_id) = layout_id else { return Ok(None) };
    let current_km = odometer_truth(pool, vehicle_id)?.map(|o| o.km);

    let mut stmt = conn.prepare(
        "SELECT id, section, section_index, axle_type, is_steering, is_lifted
           FROM chassis_axles WHERE layout_id=?1 AND deleted_at IS NULL
          ORDER BY CASE section WHEN 'tractor' THEN 0 ELSE 1 END, section_index",
    )?;
    let axles = stmt
        .query_map(params![layout_id], |r| {
            Ok(AxleRow {
                id: r.get(0)?,
                section: r.get(1)?,
                section_index: r.get(2)?,
                axle_type: r.get(3)?,
                is_steering: r.get::<_, i64>(4)? != 0,
                is_lifted: r.get::<_, i64>(5)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let pending_asg = pending_ids(&conn, "tire_assignments")?;
    let mut stmt = conn.prepare(
        "SELECT p.id, p.axle_id, p.side, p.depth, p.is_spare, p.spare_index, p.position_code,
                ta.id, ta.tire_id, t.dot_code, t.brand, t.status, ta.mounted_at,
                ta.mounted_odometer,
                COALESCE(t.total_km,0)
                  + COALESCE((SELECT SUM(x.dismounted_odometer - x.mounted_odometer)
                        FROM tire_assignments x
                        LEFT JOIN chassis_positions xp ON xp.id = x.position_id
                       WHERE x.tire_id = t.id AND x.deleted_at IS NULL
                         AND x.dismounted_at IS NOT NULL
                         AND x.mounted_odometer IS NOT NULL AND x.dismounted_odometer IS NOT NULL
                         AND x.dismounted_odometer > x.mounted_odometer
                         AND COALESCE(xp.is_spare,0)=0), 0),
                t.model, t.size, t.origin, t.retread_count, ta.mount_reason
           FROM chassis_positions p
           LEFT JOIN tire_assignments ta ON ta.position_id = p.id
                AND ta.dismounted_at IS NULL AND ta.deleted_at IS NULL
           LEFT JOIN tires t ON t.id = ta.tire_id
          WHERE p.layout_id=?1 AND p.deleted_at IS NULL
          ORDER BY p.position_code",
    )?;
    let mut positions = stmt
        .query_map(params![layout_id], |r| {
            let assignment_id: Option<String> = r.get(7)?;
            Ok(PositionRow {
                id: r.get(0)?,
                axle_id: r.get(1)?,
                side: r.get(2)?,
                depth: r.get(3)?,
                is_spare: r.get::<_, i64>(4)? != 0,
                spare_index: r.get(5)?,
                position_code: r.get(6)?,
                pending: assignment_id
                    .as_ref()
                    .map(|a| pending_asg.contains(a))
                    .unwrap_or(false),
                assignment_id,
                tire_id: r.get(8)?,
                dot_code: r.get(9)?,
                brand: r.get(10)?,
                tire_status: r.get(11)?,
                mounted_at: r.get(12)?,
                mounted_odometer: r.get(13)?,
                total_km: r.get(14)?,
                model: r.get(15)?,
                size: r.get(16)?,
                origin: r.get(17)?,
                retread_count: r.get(18)?,
                mount_reason: r.get(19)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Live km for mounted wheels (same rule as tires_list).
    if let Some(now_km) = current_km {
        for p in &mut positions {
            if p.is_spare {
                continue; // a tire riding as a spare doesn't roll
            }
            if let (Some(total), Some(mounted)) = (p.total_km, p.mounted_odometer) {
                if now_km > mounted {
                    p.total_km = Some(total + (now_km - mounted));
                }
            }
        }
    }

    Ok(Some(ChassisPayload { layout_id, axles, positions }))
}

// ═════════════════════════════ reference ═════════════════════════════════════

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CategoryRow {
    pub id: String,
    pub name_ar: String,
    pub name_en: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub sort_order: i64,
}

pub fn categories_list(pool: &DbPool) -> AppResult<Vec<CategoryRow>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, name_ar, name_en, icon, color, sort_order FROM maintenance_categories ORDER BY sort_order",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(CategoryRow {
                id: r.get(0)?,
                name_ar: r.get(1)?,
                name_en: r.get(2)?,
                icon: r.get(3)?,
                color: r.get(4)?,
                sort_order: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct ClassRow {
    pub id: String,
    pub name_ar: String,
    pub name_en: String,
    pub sort_order: i64,
}

pub fn classes_list(pool: &DbPool) -> AppResult<Vec<ClassRow>> {
    let conn = pool.get()?;
    let mut stmt =
        conn.prepare("SELECT id, name_ar, name_en, sort_order FROM vehicle_classes ORDER BY sort_order")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ClassRow {
                id: r.get(0)?,
                name_ar: r.get(1)?,
                name_en: r.get(2)?,
                sort_order: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PlanRow {
    pub id: String,
    pub class_id: String,
    pub category_id: String,
    pub trigger_type: String,
    pub interval_km: Option<i64>,
    pub interval_days: Option<i64>,
    pub lead_warn_km: Option<i64>,
    pub lead_warn_days: Option<i64>,
    pub is_active: bool,
}

pub fn plans_list(pool: &DbPool) -> AppResult<Vec<PlanRow>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, class_id, category_id, trigger_type, interval_km, interval_days,
                lead_warn_km, lead_warn_days, is_active
           FROM service_plans WHERE deleted_at IS NULL ORDER BY class_id, category_id",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(PlanRow {
                id: r.get(0)?,
                class_id: r.get(1)?,
                category_id: r.get(2)?,
                trigger_type: r.get(3)?,
                interval_km: r.get(4)?,
                interval_days: r.get(5)?,
                lead_warn_km: r.get(6)?,
                lead_warn_days: r.get(7)?,
                is_active: r.get::<_, i64>(8)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

// ═════════════════════════════ omnisearch ════════════════════════════════════

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct SearchResults {
    pub trucks: Vec<TruckRow>,
    pub tires: Vec<TireRow>,
    pub work_orders: Vec<WoListRow>,
}

pub fn search_all(pool: &DbPool, q: &str) -> AppResult<SearchResults> {
    let nq = normalize_digits(q.trim());
    if nq.is_empty() {
        return Ok(SearchResults { trucks: vec![], tires: vec![], work_orders: vec![] });
    }
    let mut trucks = truck_list(pool, Some(&nq))?;
    trucks.truncate(8);
    let mut tires = tires_list(pool, None, Some(&nq))?;
    tires.truncate(8);
    let up = nq.to_uppercase();
    let mut work_orders: Vec<WoListRow> = wo_list(pool, None, None)?
        .into_iter()
        .filter(|w| {
            w.plate.contains(&nq)
                || w.title.as_deref().map(|t| t.to_uppercase().contains(&up)).unwrap_or(false)
        })
        .collect();
    work_orders.truncate(8);
    Ok(SearchResults { trucks, tires, work_orders })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::domain::{
        self, ChassisConfig, DismountInput, MountFromStockInput, MountUsedInput,
    };
    use rusqlite::params;

    fn pool() -> DbPool {
        let dir = std::env::temp_dir().join(format!("apex-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = DbPool::open(&dir.join("t.db")).unwrap();
        p.run_migrations().unwrap();
        p
    }

    fn seed_vehicle(pool: &DbPool, id: i64, plate: &str, fuel: i64) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO vehicles_cache (id, car_no_plate, last_fuel_odometer, raw_payload, fetched_at)
             VALUES (?1, ?2, ?3, '{}', ?4)",
            params![id, plate, fuel, domain::now_iso()],
        )
        .unwrap();
    }

    fn seed_stock(pool: &DbPool) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO tire_stock_cache (id, brand, model, size, on_hand_qty, fetched_at)
             VALUES ('s1', 'Pirelli', 'FR01', '315/80R22.5', 5, ?1)",
            params![domain::now_iso()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO oil_stock_cache (id, oil_type, liters_on_hand, fetched_at)
             VALUES ('o1', '15W-40', 200.0, ?1)",
            params![domain::now_iso()],
        )
        .unwrap();
    }

    fn seed_plan(pool: &DbPool, class_id: &str, category: &str, interval_km: i64) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO vehicle_classes (id, name_ar, name_en, sort_order) VALUES (?1, ?1, ?1, 1)
             ON CONFLICT(id) DO NOTHING",
            params![class_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO service_plans (id, class_id, category_id, trigger_type, interval_km,
                                        lead_warn_km, lead_warn_days, is_active)
             VALUES (?1, ?2, ?3, 'mileage', ?4, 500, 14, 1)",
            params![uuid::Uuid::new_v4().to_string(), class_id, category, interval_km],
        )
        .unwrap();
    }

    #[test]
    fn chassis_generates_28_positions_with_codes() {
        let p = pool();
        seed_vehicle(&p, 1, "ف ل ص 8351", 100_000);
        domain::chassis_create(
            &p,
            1,
            &ChassisConfig { drive_axles: 2, trailer_axles: 4, spares: 2, single_trailer_axles: None },
            9,
        )
        .unwrap();
        let ch = chassis_get(&p, 1).unwrap().expect("chassis");
        assert_eq!(ch.positions.len(), 28);
        assert_eq!(ch.axles.len(), 7);
        let codes: Vec<&str> = ch.positions.iter().map(|x| x.position_code.as_str()).collect();
        for c in ["H1L", "H1R", "H2LO", "H3RI", "TR4RO", "SP1", "SP2"] {
            assert!(codes.contains(&c), "missing {c}");
        }
        assert!(ch.positions.iter().all(|x| x.tire_id.is_none()), "fresh chassis is empty");
    }

    #[test]
    fn mount_from_stock_projects_stock_and_guards_the_position() {
        let p = pool();
        seed_vehicle(&p, 2, "ف د ى 6738", 200_000);
        seed_stock(&p);
        domain::chassis_create(
            &p,
            2,
            &ChassisConfig { drive_axles: 2, trailer_axles: 3, spares: 1, single_trailer_axles: None },
            9,
        )
        .unwrap();
        let wo = domain::wo_open(&p, 2, Some(200_000), 9).unwrap();
        let ch = chassis_get(&p, 2).unwrap().unwrap();
        let pos = ch.positions.iter().find(|x| x.position_code == "H2LO").unwrap().id.clone();

        let (tire_id, _) = domain::mount_from_stock(
            &p,
            &MountFromStockInput {
                position_id: pos.clone(),
                vehicle_id: 2,
                work_order_id: wo.clone(),
                brand: "Pirelli".into(),
                model: Some("FR01".into()),
                size: Some("315/80R22.5".into()),
                dot_code: Some("DOT-1234".into()),
                odometer: Some(200_000),
            },
            9,
        )
        .unwrap();

        // Projection: snapshot 5, one queued shipment tire ⇒ projected 4.
        let sv = stock_view(&p).unwrap();
        assert_eq!(sv.tires[0].snapshot_qty, 5);
        assert_eq!(sv.tires[0].pending_debits, 1);
        assert_eq!(sv.tires[0].projected_qty, 4);

        // The diagram sees the mount, flagged as still-queued.
        let ch = chassis_get(&p, 2).unwrap().unwrap();
        let mounted = ch.positions.iter().find(|x| x.position_code == "H2LO").unwrap();
        assert_eq!(mounted.tire_id.as_deref(), Some(tire_id.as_str()));
        assert!(mounted.pending, "unacked mount is visibly queued");

        // Same position again must refuse locally (mirror of uq_active_position).
        let again = domain::mount_from_stock(
            &p,
            &MountFromStockInput {
                position_id: pos,
                vehicle_id: 2,
                work_order_id: wo,
                brand: "Pirelli".into(),
                model: None,
                size: None,
                dot_code: None,
                odometer: None,
            },
            9,
        );
        assert!(again.is_err(), "occupied position must reject a second mount");
    }

    #[test]
    fn dismount_derives_status_and_km_and_pool_tires_remount() {
        let p = pool();
        seed_vehicle(&p, 3, "ف ق ص 4253", 300_000);
        seed_stock(&p);
        domain::chassis_create(
            &p,
            3,
            &ChassisConfig { drive_axles: 1, trailer_axles: 2, spares: 1, single_trailer_axles: None },
            9,
        )
        .unwrap();
        let wo = domain::wo_open(&p, 3, Some(300_000), 9).unwrap();
        let ch = chassis_get(&p, 3).unwrap().unwrap();
        let pos_a = ch.positions.iter().find(|x| x.position_code == "H2LO").unwrap().id.clone();
        let pos_b = ch.positions.iter().find(|x| x.position_code == "H2LI").unwrap().id.clone();

        let (tire_id, asg) = domain::mount_from_stock(
            &p,
            &MountFromStockInput {
                position_id: pos_a,
                vehicle_id: 3,
                work_order_id: wo.clone(),
                brand: "Pirelli".into(),
                model: Some("FR01".into()),
                size: Some("315/80R22.5".into()),
                dot_code: None,
                odometer: Some(300_000),
            },
            9,
        )
        .unwrap();

        // Rotation dismount → back to the used pool with km accrued.
        domain::dismount(
            &p,
            &DismountInput {
                assignment_id: asg,
                odometer: Some(320_000),
                reason: "rotation".into(),
                work_order_id: Some(wo.clone()),
            },
            9,
        )
        .unwrap();
        let t = tire_file(&p, &tire_id).unwrap().unwrap();
        assert_eq!(t.tire.status, "in_stock_used");
        assert_eq!(t.tire.total_km, 20_000);
        assert_eq!(t.mounts.len(), 1);

        // The pool tire mounts again (used flow), then a worn dismount scraps it.
        let asg2 = domain::mount_used(
            &p,
            &MountUsedInput {
                tire_id: tire_id.clone(),
                position_id: pos_b,
                vehicle_id: 3,
                work_order_id: wo,
                odometer: Some(320_000),
                reason: "rotation".into(),
            },
            9,
        )
        .unwrap();
        // The dismount happens under a DIFFERENT work order than the mount —
        // it must show up in that WO's tire work (dismount_work_order_id).
        let wo2 = domain::wo_open(&p, 3, Some(345_000), 9).unwrap();
        domain::dismount(
            &p,
            &DismountInput {
                assignment_id: asg2,
                odometer: Some(345_000),
                reason: "worn".into(),
                work_order_id: Some(wo2.clone()),
            },
            9,
        )
        .unwrap();
        let d2 = wo_detail(&p, &wo2).unwrap().unwrap();
        assert_eq!(d2.tire_ops.len(), 1, "dismount is attributed to the WO it happened under");
        assert!(d2.tire_ops[0].dismounted_at.is_some());
        let t = tire_file(&p, &tire_id).unwrap().unwrap();
        assert_eq!(t.tire.status, "scrapped", "worn → scrapped, same rule as the server");
        assert_eq!(t.tire.total_km, 45_000, "km accrues across mounts");
    }

    #[test]
    fn plans_due_flow_with_oil_flag_and_override() {
        let p = pool();
        seed_vehicle(&p, 4, "ف ر س 4593", 100_000);
        seed_stock(&p);
        seed_plan(&p, "tractor", "oil_change", 10_000);
        domain::class_assign(&p, 4, "tractor", 9).unwrap();

        // Never done yet.
        let due = due_board(&p, Some(4)).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].status, "never_done");

        // A work order with an oil change resets the clock.
        let wo = domain::wo_open(&p, 4, Some(105_000), 9).unwrap();
        let (_, flagged) = domain::oil_add(&p, &wo, 4, "15W-40", 40.0, Some(105_100), 9).unwrap();
        assert!(flagged, "40 L flags");
        let due = due_board(&p, Some(4)).unwrap();
        assert_eq!(due[0].status, "ok");
        assert_eq!(due[0].next_due_km, Some(115_000));
        assert_eq!(due[0].current_odometer, Some(105_100), "oil odometer beats the fuel reading");

        // A manual override pushes it overdue.
        domain::override_set(&p, 4, 116_000, None, 9).unwrap();
        let due = due_board(&p, Some(4)).unwrap();
        assert_eq!(due[0].status, "overdue");
        assert_eq!(due[0].odometer_source.as_deref(), Some("manual_override"));
    }

    #[test]
    fn editing_history_odometers_repropagates_km() {
        let p = pool();
        seed_vehicle(&p, 9, "ف ع ص 4381", 400_000);
        seed_stock(&p);
        domain::chassis_create(
            &p,
            9,
            &ChassisConfig { drive_axles: 1, trailer_axles: 0, spares: 0, single_trailer_axles: None },
            9,
        )
        .unwrap();
        let wo = domain::wo_open(&p, 9, Some(400_000), 9).unwrap();
        let ch = chassis_get(&p, 9).unwrap().unwrap();
        let pos = ch.positions.iter().find(|x| x.position_code == "H2LO").unwrap().id.clone();
        let (tire_id, asg) = domain::mount_from_stock(
            &p,
            &MountFromStockInput {
                position_id: pos,
                vehicle_id: 9,
                work_order_id: wo.clone(),
                brand: "Pirelli".into(),
                model: Some("FR01".into()),
                size: Some("315/80R22.5".into()),
                dot_code: None,
                odometer: Some(400_000),
            },
            9,
        )
        .unwrap();
        domain::dismount(
            &p,
            &DismountInput {
                assignment_id: asg.clone(),
                odometer: Some(430_000),
                reason: "rotation".into(),
                work_order_id: Some(wo),
            },
            9,
        )
        .unwrap();
        assert_eq!(tire_file(&p, &tire_id).unwrap().unwrap().tire.total_km, 30_000);

        // The dismount odometer was mistyped — correct it. km repropagates.
        domain::assignment_set_odometers(&p, &asg, None, Some(410_000), 9).unwrap();
        assert_eq!(
            tire_file(&p, &tire_id).unwrap().unwrap().tire.total_km,
            10_000,
            "derived km follows the corrected history"
        );

        // Nonsense edits are rejected.
        assert!(domain::assignment_set_odometers(&p, &asg, Some(420_000), None, 9).is_err());
    }

    #[test]
    fn override_corrects_downward_and_later_readings_resume() {
        let p = pool();
        // Falcon reports an inflated 500k. The mechanic corrects DOWN to 300k.
        seed_vehicle(&p, 7, "ف ج م 8567", 500_000);
        domain::override_set(&p, 7, 300_000, Some("قراءة التابلوه"), 9).unwrap();
        let o = odometer_truth(&p, 7).unwrap().unwrap();
        assert_eq!(o.km, 300_000, "the correction wins over the inflated reading");
        assert_eq!(o.source, "manual_override");

        // A reading recorded AFTER the correction resumes normal MAX rules.
        let _wo = domain::wo_open(&p, 7, Some(305_000), 9).unwrap();
        let o = odometer_truth(&p, 7).unwrap().unwrap();
        assert_eq!(o.km, 305_000);
        assert_eq!(o.source, "work_order");
    }

    #[test]
    fn mounted_tire_km_is_live_with_the_odometer() {
        let p = pool();
        seed_vehicle(&p, 8, "ف ل ص 4317", 300_000);
        seed_stock(&p);
        domain::chassis_create(
            &p,
            8,
            &ChassisConfig { drive_axles: 1, trailer_axles: 0, spares: 0, single_trailer_axles: None },
            9,
        )
        .unwrap();
        let wo = domain::wo_open(&p, 8, Some(300_000), 9).unwrap();
        let ch = chassis_get(&p, 8).unwrap().unwrap();
        let pos = ch.positions.iter().find(|x| x.position_code == "H2LO").unwrap().id.clone();
        let (tire_id, _) = domain::mount_from_stock(
            &p,
            &MountFromStockInput {
                position_id: pos,
                vehicle_id: 8,
                work_order_id: wo,
                brand: "Pirelli".into(),
                model: Some("FR01".into()),
                size: Some("315/80R22.5".into()),
                dot_code: None,
                odometer: Some(300_000),
            },
            9,
        )
        .unwrap();

        // Freshly mounted: no run yet.
        let t = tire_file(&p, &tire_id).unwrap().unwrap();
        assert_eq!(t.tire.total_km, 0);

        // Correcting the odometer moves the mounted tire's km immediately.
        domain::override_set(&p, 8, 320_000, None, 9).unwrap();
        let t = tire_file(&p, &tire_id).unwrap().unwrap();
        assert_eq!(t.tire.total_km, 20_000, "mounted km is live, not dismount-only");
        let ch = chassis_get(&p, 8).unwrap().unwrap();
        let w = ch.positions.iter().find(|x| x.tire_id.as_deref() == Some(tire_id.as_str())).unwrap();
        assert_eq!(w.total_km, Some(20_000), "diagram shows the same live km");
    }

    #[test]
    fn search_normalizes_arabic_indic_digits() {
        let p = pool();
        seed_vehicle(&p, 5, "ف ل ص 8351", 0);
        let r = search_all(&p, "٨٣٥١").unwrap();
        assert_eq!(r.trucks.len(), 1, "٨٣٥١ finds plate 8351");
        let r = search_all(&p, "8351").unwrap();
        assert_eq!(r.trucks.len(), 1);
    }

    #[test]
    fn home_summary_shows_open_wos_and_honest_queue() {
        let p = pool();
        seed_vehicle(&p, 6, "ف ى ر 8427", 50_000);
        seed_stock(&p);
        let _wo = domain::wo_open(&p, 6, Some(50_000), 9).unwrap();
        let h = home_summary(&p).unwrap();
        assert_eq!(h.open_wos.len(), 1);
        assert_eq!(h.open_wos[0].plate, "ف ى ر 8427");
        assert!(h.open_wos[0].pending, "unacked WO is marked pending");
        assert!(h.sync_pending >= 1, "queue is honest");
    }
}
