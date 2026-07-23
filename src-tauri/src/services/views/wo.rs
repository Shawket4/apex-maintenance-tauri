//! Work orders: list, detail (tasks/oil/tire ops with pending flags).


use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::db::DbPool;
use crate::AppResult;

use super::*;

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
    // "Any part of this WO still queued" includes its children — a WO whose
    // tasks/oil/tire ops are unacked is still pending work even after the WO
    // row itself acked.
    let mut child_stmt = conn.prepare(
        "SELECT 1 FROM outbox o
          WHERE o.status IN ('pending','inflight','dead')
            AND (
                 (o.entity_type = 'work_order_tasks'
                    AND o.entity_id IN (SELECT id FROM work_order_tasks WHERE work_order_id = ?1))
              OR (o.entity_type = 'oil_changes'
                    AND o.entity_id IN (SELECT id FROM oil_changes WHERE work_order_id = ?1))
              OR (o.entity_type = 'tire_assignments'
                    AND o.entity_id IN (SELECT id FROM tire_assignments
                                         WHERE work_order_id = ?1 OR dismount_work_order_id = ?1))
            )
          LIMIT 1",
    )?;
    for w in &mut rows {
        w.pending = pending_wos.contains(&w.id)
            || child_stmt.exists(params![w.id])?;
    }
    drop(child_stmt);
    Ok(rows)
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct TaskRow {
    pub id: String,
    pub kind: String,
    pub category_id: Option<String>,
    pub category_name_ar: Option<String>,
    pub description_ar: Option<String>,
    /// Done-ness is what resets the due clock (0017) — the checkbox state.
    pub is_done: bool,
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
        "SELECT t.id, t.kind, t.category_id, c.name_ar, t.description_ar, t.is_done, t.created_at
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
                is_done: r.get::<_, i64>(5)? != 0,
                created_at: r.get(6)?,
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

pub(crate) fn tire_ops_for(
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

