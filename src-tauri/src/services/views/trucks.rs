//! Fleet list + truck file.


use serde::Serialize;

use crate::db::DbPool;
use crate::AppResult;

use super::*;

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
    /// Plans that apply to this truck and have never been recorded as done.
    pub never_done_count: i64,
    /// Plans that apply to this truck at all. 0 = nothing is being tracked
    /// (no class, or a class with no plans) — that is not "all good".
    pub plan_count: i64,
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
                never_done_count: 0,
                plan_count: 0,
                has_chassis: r.get::<_, i64>(9)? > 0,
                driver_name: r.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Badges from the same due query the board and the home counts use, so
    // the three never disagree.
    let due = due_board(pool, None)?;
    for t in &mut rows {
        let mine = || due.iter().filter(|d| d.vehicle_id == t.id);
        t.plan_count = mine().count() as i64;
        t.overdue_count = mine().filter(|d| d.status == "overdue").count() as i64;
        t.never_done_count = mine().filter(|d| d.status == "never_done").count() as i64;
        t.due_soon_count = mine().filter(|d| d.status == "due_soon").count() as i64;
    }

    if let Some(q) = q {
        let nq = fold_search(q);
        if !nq.is_empty() {
            rows.retain(|t| {
                fold_search(&t.plate).contains(&nq)
                    || t.driver_name.as_deref().map(|d| fold_search(d).contains(&nq)).unwrap_or(false)
            });
        }
    }
    Ok(rows)
}

pub fn truck_file(pool: &DbPool, vehicle_id: i64) -> AppResult<Option<TruckRow>> {
    Ok(truck_list(pool, None)?.into_iter().find(|t| t.id == vehicle_id))
}

