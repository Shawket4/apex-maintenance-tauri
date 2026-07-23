//! Chassis payload for the diagram (positions with live tire facts).


use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::db::DbPool;
use crate::AppResult;

use super::*;

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
    let sql = format!(
        "SELECT p.id, p.axle_id, p.side, p.depth, p.is_spare, p.spare_index, p.position_code,
                ta.id, ta.tire_id, t.dot_code, t.brand, t.status, ta.mounted_at,
                ta.mounted_odometer,
                COALESCE(t.total_km,0)
                  + {TIRE_KM_ACCRUED},
                t.model, t.size, t.origin, t.retread_count, ta.mount_reason
           FROM chassis_positions p
           LEFT JOIN tire_assignments ta ON ta.position_id = p.id
                AND ta.dismounted_at IS NULL AND ta.deleted_at IS NULL
           LEFT JOIN tires t ON t.id = ta.tire_id
          WHERE p.layout_id=?1 AND p.deleted_at IS NULL
          ORDER BY p.position_code",
    );
    let mut stmt = conn.prepare(&sql)?;
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

