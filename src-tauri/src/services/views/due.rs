//! Due board — the client mirror of maint-rust v_maintenance_due (0017).


use rusqlite::params;
use serde::Serialize;

use crate::db::DbPool;
use crate::AppResult;

use super::*;

// ═════════════════════════════ due ═══════════════════════════════════════════

/// Local mirror of maint-rust v_maintenance_due (plans × class assignments,
/// last-done from categorized work-order tasks, odometer truth).
/// Time comparisons go through julianday() because pulled rows carry Postgres
/// timestamp formatting while local writes carry RFC3339-Z — lexical compare
/// across the two lies.
pub(crate) const DUE_TAIL: &str = "
last_done AS (
    -- Mirror of maint-rust 0017: only DONE tasks reset the due clock, and
    -- last_at/last_km come from the SAME (latest) work order — independent
    -- MAXes could pair one WO's date with another WO's odometer.
    SELECT vehicle_id, category_id, last_at, last_km FROM (
        SELECT wo.vehicle_id, t.category_id,
               wo.opened_at        AS last_at,
               wo.odometer_at_open AS last_km,
               ROW_NUMBER() OVER (
                   PARTITION BY wo.vehicle_id, t.category_id
                   ORDER BY wo.opened_at DESC
               ) AS rn
          FROM work_order_tasks t
          JOIN work_orders wo ON wo.id = t.work_order_id
         WHERE t.deleted_at IS NULL AND wo.deleted_at IS NULL
           AND t.category_id IS NOT NULL AND t.is_done = 1
    ) WHERE rn = 1
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
                -- 0017: no km on the latest record = no usable baseline for a
                -- mileage plan — surface it instead of silently 'ok' forever.
                WHEN ld.last_km IS NULL THEN 'never_done'
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

pub(crate) fn map_due(r: &rusqlite::Row<'_>) -> rusqlite::Result<DueRow> {
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
    let rows = match vehicle_id {
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
    Ok(rows)
}

