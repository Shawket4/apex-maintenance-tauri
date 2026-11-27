//! Batteries: a truck's slots, every battery, and the battery work of one
//! work order. Pending flags come from the outbox, as everywhere.

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::db::DbPool;
use crate::services::domain;
use crate::AppResult;

use super::*;

/// One battery: what it is, its warranty (counted from its first fitting),
/// where it is now.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct BatteryRow {
    pub id: String,
    pub brand: String,
    pub model: Option<String>,
    pub capacity_ah: Option<i64>,
    pub voltage: Option<i64>,
    pub cca: Option<i64>,
    pub serial: Option<String>,
    pub date_code: Option<String>,
    pub warranty_months: Option<i64>,
    /// installed | in_stock_used | charging | warranty | scrapped
    pub status: String,
    /// stock (new from the shelf) | legacy (registered already on a truck)
    pub origin: String,
    pub notes: Option<String>,
    pub registered_at: Option<String>,
    pub first_installed_at: Option<String>,
    /// YYYY-MM-DD, when both the first fitting and the warranty are known.
    pub warranty_until: Option<String>,
    /// Where it is fitted now.
    pub vehicle_id: Option<i64>,
    pub plate: Option<String>,
    pub slot: Option<i64>,
    pub installed_at: Option<String>,
    pub pending: bool,
}

/// One fitting of a battery into a slot (open, or closed by a removal).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct BatteryFitRow {
    pub install_id: String,
    pub vehicle_id: i64,
    pub plate: Option<String>,
    pub slot: i64,
    pub battery: BatteryRow,
    pub work_order_id: Option<String>,
    pub installed_at: String,
    pub installed_odometer: Option<i64>,
    pub removed_at: Option<String>,
    pub removed_odometer: Option<i64>,
    /// dead | weak | damaged | moved | warranty | other
    pub removal_reason: Option<String>,
    /// in_stock_used | charging | warranty | scrapped
    pub removal_outcome: Option<String>,
    pub removal_work_order_id: Option<String>,
    pub notes: Option<String>,
    /// Open fitting: km since it was fitted (the truck's odometer now − then).
    /// Closed: km between fitting and removal.
    pub km: Option<i64>,
    pub pending: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct BatterySlot {
    pub slot: i64,
    pub fit: Option<BatteryFitRow>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct BatteryTruckView {
    pub vehicle_id: i64,
    pub slots: Vec<BatterySlot>,
    /// Batteries taken off this truck, newest first (last 30).
    pub removed: Vec<BatteryFitRow>,
    pub layout_pending: bool,
}

const BATTERY_COLS: &str = "b.id, b.brand, b.model, b.capacity_ah, b.voltage, b.cca, b.serial, b.date_code,
    b.warranty_months, b.status, b.origin, b.notes_ar, b.created_at,
    (SELECT MIN(x.installed_at) FROM battery_installs x WHERE x.battery_id = b.id AND x.deleted_at IS NULL)";

fn warranty_until(first: Option<&str>, months: Option<i64>) -> Option<String> {
    let (first, months) = (first?, months?);
    let d = chrono::DateTime::parse_from_rfc3339(first).ok()?.with_timezone(&chrono_tz::Africa::Cairo).date_naive();
    d.checked_add_months(chrono::Months::new(u32::try_from(months).ok()?)).map(|d| d.format("%Y-%m-%d").to_string())
}

/// Reads BATTERY_COLS starting at `at`.
fn battery_at(r: &rusqlite::Row<'_>, at: usize) -> rusqlite::Result<BatteryRow> {
    let first: Option<String> = r.get(at + 13)?;
    let months: Option<i64> = r.get(at + 8)?;
    Ok(BatteryRow {
        id: r.get(at)?,
        brand: r.get::<_, Option<String>>(at + 1)?.unwrap_or_default(),
        model: r.get(at + 2)?,
        capacity_ah: r.get(at + 3)?,
        voltage: r.get(at + 4)?,
        cca: r.get(at + 5)?,
        serial: r.get(at + 6)?,
        date_code: r.get(at + 7)?,
        warranty_months: months,
        status: r.get::<_, Option<String>>(at + 9)?.unwrap_or_default(),
        origin: r.get::<_, Option<String>>(at + 10)?.unwrap_or_default(),
        notes: r.get(at + 11)?,
        registered_at: r.get(at + 12)?,
        warranty_until: warranty_until(first.as_deref(), months),
        first_installed_at: first,
        vehicle_id: None,
        plate: None,
        slot: None,
        installed_at: None,
        pending: false,
    })
}

/// Every battery, fitted ones first. `status` filters.
pub fn batteries_list(pool: &DbPool, status: Option<&str>) -> AppResult<Vec<BatteryRow>> {
    let conn = pool.get()?;
    let pending = pending_ids(&conn, "batteries")?;
    let sql = format!(
        "SELECT {BATTERY_COLS}, i.vehicle_id, v.car_no_plate, i.slot, i.installed_at
           FROM batteries b
           LEFT JOIN battery_installs i ON i.battery_id = b.id AND i.removed_at IS NULL AND i.deleted_at IS NULL
           LEFT JOIN vehicles_cache v ON v.id = i.vehicle_id
          WHERE b.deleted_at IS NULL AND (?1 IS NULL OR b.status = ?1)
          ORDER BY (b.status = 'installed') DESC, v.car_no_plate, i.slot, b.brand, julianday(b.created_at) DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![status], |r| {
            let mut b = battery_at(r, 0)?;
            b.vehicle_id = r.get(14)?;
            b.plate = r.get(15)?;
            b.slot = r.get(16)?;
            b.installed_at = r.get(17)?;
            b.pending = pending.contains(&b.id);
            Ok(b)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn fits(conn: &Connection, where_clause: &str, args: &[&dyn rusqlite::types::ToSql], current_km: Option<i64>) -> AppResult<Vec<BatteryFitRow>> {
    let pending_installs = pending_ids(conn, "battery_installs")?;
    let pending_batteries = pending_ids(conn, "batteries")?;
    let sql = format!(
        "SELECT i.id, i.vehicle_id, v.car_no_plate, i.slot, i.work_order_id, i.installed_at, i.installed_odometer,
                i.removed_at, i.removed_odometer, i.removal_reason, i.removal_outcome, i.removal_work_order_id, i.notes,
                {BATTERY_COLS}
           FROM battery_installs i
           JOIN batteries b ON b.id = i.battery_id
           LEFT JOIN vehicles_cache v ON v.id = i.vehicle_id
          WHERE i.deleted_at IS NULL AND {where_clause}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(args, |r| {
            let mut battery = battery_at(r, 13)?;
            battery.pending = pending_batteries.contains(&battery.id);
            let id: String = r.get(0)?;
            let fitted_km: Option<i64> = r.get(6)?;
            let removed_at: Option<String> = r.get(7)?;
            let removed_km: Option<i64> = r.get(8)?;
            let km = match (&removed_at, fitted_km, removed_km, current_km) {
                (Some(_), Some(f), Some(t), _) if t >= f => Some(t - f),
                (None, Some(f), _, Some(now)) if now >= f => Some(now - f),
                _ => None,
            };
            Ok(BatteryFitRow {
                pending: pending_installs.contains(&id),
                install_id: id,
                vehicle_id: r.get(1)?,
                plate: r.get(2)?,
                slot: r.get(3)?,
                work_order_id: r.get(4)?,
                installed_at: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                installed_odometer: fitted_km,
                removed_at,
                removed_odometer: removed_km,
                removal_reason: r.get(9)?,
                removal_outcome: r.get(10)?,
                removal_work_order_id: r.get(11)?,
                notes: r.get(12)?,
                km,
                battery,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// A truck's battery slots (each with what is fitted) and what came off it.
pub fn battery_truck(pool: &DbPool, vehicle_id: i64) -> AppResult<BatteryTruckView> {
    let current_km = odometer_truth(pool, vehicle_id)?.map(|o| o.km);
    let conn = pool.get()?;
    let n = domain::battery_slots(&conn, vehicle_id)?;
    let fitted = fits(&conn, "i.vehicle_id = ?1 AND i.removed_at IS NULL ORDER BY i.slot", &[&vehicle_id], current_km)?;
    let slots = (1..=n)
        .map(|slot| BatterySlot { slot, fit: fitted.iter().find(|f| f.slot == slot).cloned() })
        .collect();
    let removed = fits(
        &conn,
        "i.vehicle_id = ?1 AND i.removed_at IS NOT NULL ORDER BY julianday(i.removed_at) DESC LIMIT 30",
        &[&vehicle_id],
        None,
    )?;
    let layout_pending = pending_ids(&conn, "battery_layouts")?.contains(&vehicle_id.to_string());
    Ok(BatteryTruckView { vehicle_id, slots, removed, layout_pending })
}

/// Battery work recorded under one work order: fittings and removals.
pub(crate) fn battery_ops_for_wo(conn: &Connection, wo_id: &str, current_km: Option<i64>) -> AppResult<Vec<BatteryFitRow>> {
    fits(
        conn,
        "(i.work_order_id = ?1 OR i.removal_work_order_id = ?1) ORDER BY julianday(i.installed_at), i.slot",
        &[&wo_id],
        current_km,
    )
}

/// The battery fittings a battery has had, newest first.
pub fn battery_history(pool: &DbPool, battery_id: &str) -> AppResult<Vec<BatteryFitRow>> {
    let conn = pool.get()?;
    fits(&conn, "i.battery_id = ?1 ORDER BY julianday(i.installed_at) DESC", &[&battery_id], None)
}
