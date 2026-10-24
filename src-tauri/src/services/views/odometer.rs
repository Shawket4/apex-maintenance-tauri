//! Odometer truth — the client mirror of maint-rust v_current_odometer
//! (0014 + 0017 + 0019). ODO_CTE is the one home of the arbitration SQL.


use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::db::DbPool;
use crate::AppResult;


// ═════════════════════════════ odometer truth ════════════════════════════════

/// Mirrors maint-rust v_current_odometer (0014). A manual override is an
/// explicit human correction, not one more reading competing by MAX:
///  * oil/WO readings recorded BEFORE the correction are discarded;
///  * the Falcon fuel reading is discarded while it is ≤ the value it showed
///    when the correction was made (superseded_km);
///  * everything observed after the correction competes by MAX as usual.
pub(crate) const ODO_CTE: &str = "
readings(vehicle_id, km, src, observed_at) AS (
    SELECT v.id, v.last_fuel_odometer, 'falcon_fuel', v.fetched_at
      FROM vehicles_cache v
      LEFT JOIN vehicle_odometer_overrides ovf
             ON ovf.vehicle_id = v.id AND ovf.odometer IS NOT NULL
     WHERE v.last_fuel_odometer IS NOT NULL AND v.last_fuel_odometer > 0
       AND (ovf.vehicle_id IS NULL OR v.last_fuel_odometer > COALESCE(ovf.superseded_km, -1))
    UNION ALL
    -- Falcon's cars.mileage = MAX(fuel, Falcon oil change, service invoice)
    -- readings (server 0019); same override rule as the fuel reading.
    SELECT v.id, v.mileage, 'falcon_mileage', v.fetched_at
      FROM vehicles_cache v
      LEFT JOIN vehicle_odometer_overrides ovm
             ON ovm.vehicle_id = v.id AND ovm.odometer IS NOT NULL
     WHERE v.mileage IS NOT NULL AND v.mileage > 0
       AND (ovm.vehicle_id IS NULL OR v.mileage > COALESCE(ovm.superseded_km, -1))
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
      FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY vehicle_id
                                        ORDER BY km DESC, (src = 'falcon_mileage')) rn
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

