//! Due board — the client mirror of maint-rust v_maintenance_due (0022).


use rusqlite::params;
use serde::Serialize;

use crate::db::DbPool;
use crate::AppResult;

use super::*;

// ═════════════════════════════ due ═══════════════════════════════════════════

/// Local mirror of maint-rust v_maintenance_due (0022): plans × classified
/// vehicles, graded against the last DONE task of the plan's category.
///
///  * "last done" is when the task was ticked (done_at), not when its work
///    order was opened;
///  * the km baseline is the newest done record that HAS a reading;
///  * a plan has a km interval, a day interval, or both — due on whichever
///    comes first;
///  * a km-only plan on a vehicle with no reading is `unknown`, not `ok`.
///
/// Times go through julianday(): pulled rows carry Postgres formatting, local
/// writes RFC3339-Z, and comparing the two as text lies.
pub(crate) const DUE_TAIL: &str = "
done AS (
    SELECT wo.vehicle_id, t.category_id, t.id AS task_id,
           COALESCE(t.done_at, wo.opened_at) AS done_at,
           wo.odometer_at_open               AS km
      FROM work_order_tasks t
      JOIN work_orders wo ON wo.id = t.work_order_id
     WHERE t.deleted_at IS NULL AND wo.deleted_at IS NULL
       AND t.category_id IS NOT NULL AND t.is_done = 1
),
last_at AS (
    SELECT vehicle_id, category_id, done_at FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY vehicle_id, category_id
                                     ORDER BY julianday(done_at) DESC, task_id) rn FROM done
    ) WHERE rn = 1
),
last_km AS (
    SELECT vehicle_id, category_id, km FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY vehicle_id, category_id
                                     ORDER BY julianday(done_at) DESC, task_id) rn
          FROM done WHERE km IS NOT NULL
    ) WHERE rn = 1
),
base AS (
    SELECT
        vca.vehicle_id,
        v.car_no_plate                AS plate,
        sp.id                         AS plan_id,
        sp.category_id,
        c.name_ar                     AS category_name_ar,
        c.name_en                     AS category_name_en,
        sp.trigger_type, sp.interval_km, sp.interval_days,
        COALESCE(sp.lead_warn_km, 500) AS lead_warn_km,
        COALESCE(sp.lead_warn_days, 14) AS lead_warn_days,
        la.done_at                    AS last_at,
        lk.km                         AS last_km,
        lk.km + sp.interval_km        AS next_due_km,
        CASE WHEN la.done_at IS NOT NULL AND sp.interval_days IS NOT NULL
             THEN julianday(la.done_at) + sp.interval_days END AS next_due_jd,
        odo.current_odometer, odo.odometer_source, odo.odometer_observed_at
    FROM vehicle_class_assignments vca
    JOIN service_plans sp ON sp.class_id = vca.class_id AND sp.is_active = 1 AND sp.deleted_at IS NULL
    JOIN maintenance_categories c ON c.id = sp.category_id
    JOIN vehicles_cache v ON v.id = vca.vehicle_id AND v.source_deleted_at IS NULL
    LEFT JOIN last_at la ON la.vehicle_id = vca.vehicle_id AND la.category_id = sp.category_id
    LEFT JOIN last_km lk ON lk.vehicle_id = vca.vehicle_id AND lk.category_id = sp.category_id
    LEFT JOIN odo ON odo.vehicle_id = vca.vehicle_id
    WHERE vca.deleted_at IS NULL
),
graded AS (
    SELECT base.*,
        CASE
            WHEN interval_km IS NULL THEN NULL
            WHEN last_km IS NULL THEN 'never_done'
            WHEN current_odometer IS NULL THEN 'unknown'
            WHEN current_odometer >= next_due_km THEN 'overdue'
            WHEN current_odometer >= next_due_km - lead_warn_km THEN 'due_soon'
            ELSE 'ok'
        END AS km_status,
        CASE
            WHEN interval_days IS NULL THEN NULL
            WHEN last_at IS NULL THEN 'never_done'
            WHEN julianday('now') >= next_due_jd THEN 'overdue'
            WHEN julianday('now') >= next_due_jd - MIN(lead_warn_days, interval_days) THEN 'due_soon'
            ELSE 'ok'
        END AS time_status
    FROM base
)
SELECT
    vehicle_id, plate, plan_id, category_id, category_name_ar, category_name_en,
    trigger_type, interval_km, interval_days, last_at, last_km,
    next_due_km,
    CASE WHEN next_due_jd IS NOT NULL THEN strftime('%Y-%m-%dT%H:%M:%SZ', next_due_jd) END AS next_due_at,
    current_odometer, odometer_source, odometer_observed_at,
    CASE WHEN next_due_km IS NOT NULL AND current_odometer IS NOT NULL
         THEN next_due_km - current_odometer END AS km_remaining,
    CASE WHEN next_due_jd IS NOT NULL
         THEN CAST(julianday(date(next_due_jd, '+2 hours')) - julianday(date('now', '+2 hours')) AS INTEGER) END AS days_remaining,
    CASE
        WHEN last_at IS NULL THEN 'never_done'
        WHEN 'overdue'  IN (COALESCE(km_status,''), COALESCE(time_status,'')) THEN 'overdue'
        WHEN 'due_soon' IN (COALESCE(km_status,''), COALESCE(time_status,'')) THEN 'due_soon'
        WHEN time_status IS NULL AND km_status = 'never_done' THEN 'never_done'
        WHEN time_status IS NULL AND km_status = 'unknown' THEN 'unknown'
        ELSE 'ok'
    END AS status
FROM graded
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
    /// Km left before the plan is due (negative = km overdue).
    pub km_remaining: Option<i64>,
    /// Days left before the plan is due (negative = days overdue).
    pub days_remaining: Option<i64>,
    /// overdue | never_done | due_soon | unknown | ok
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
        km_remaining: r.get("km_remaining")?,
        days_remaining: r.get("days_remaining")?,
        status: r.get("status")?,
    })
}

pub fn due_board(pool: &DbPool, vehicle_id: Option<i64>) -> AppResult<Vec<DueRow>> {
    let conn = pool.get()?;
    // Most urgent first: by status, then by how far past (or how close).
    let order = " ORDER BY CASE status WHEN 'overdue' THEN 0 WHEN 'never_done' THEN 1 WHEN 'due_soon' THEN 2 \
                  WHEN 'unknown' THEN 3 ELSE 4 END, \
                  MIN(COALESCE(km_remaining / 100.0, 1e12), COALESCE(days_remaining, 1e12)), plate, category_id";
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

