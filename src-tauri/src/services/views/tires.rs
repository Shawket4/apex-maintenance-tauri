//! Tire inventory + tire file. Lifetime km is DERIVED (0015):
//! base + closed road deltas + live run — never accrued.


use rusqlite::params;
use serde::Serialize;

use crate::db::DbPool;
use crate::AppResult;

use super::*;

/// Σ (dismounted − mounted) over CLOSED assignments on ROAD positions —
/// the accrued half of derived lifetime km (maint-rust 0015). References the
/// outer query's tire row as `t`. The live-run term stays with each caller
/// (tires_list computes it in SQL against ODO_CTE; chassis_get against the
/// odometer it already holds).
pub(crate) const TIRE_KM_ACCRUED: &str = "COALESCE((SELECT SUM(x.dismounted_odometer - x.mounted_odometer)
                       FROM tire_assignments x
                       LEFT JOIN chassis_positions xp ON xp.id = x.position_id
                      WHERE x.tire_id = t.id AND x.deleted_at IS NULL
                        AND x.dismounted_at IS NOT NULL
                        AND x.mounted_odometer IS NOT NULL AND x.dismounted_odometer IS NOT NULL
                        AND x.dismounted_odometer > x.mounted_odometer
                        AND COALESCE(xp.is_spare,0)=0), 0)";

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
                 + {TIRE_KM_ACCRUED}
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

