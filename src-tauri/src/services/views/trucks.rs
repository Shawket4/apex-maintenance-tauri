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

