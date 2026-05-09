//! Cache-mirror upserts and freshness bookkeeping.
//!
//! All write paths from server → SQLite live here. They run inside a
//! single transaction per call so a partial failure can't leave the cache
//! half-rewritten. None of these functions ever talk to the network.

use chrono::SecondsFormat;
use rusqlite::{params, OptionalExtension};
use serde_json::Value;

use crate::{
    db::DbPool,
    models::{
        cache_freshness::CacheFreshnessRow,
        driver::{CachedDriver, DriverRow},
        invoice::{
            CachedInvoice, InvoiceCarInfo, InvoiceDetail, InvoiceItemRow, InvoiceListResult,
            InvoiceRow, InvoiceSearchResult, SearchSource,
        },
        vehicle::{CachedVehicle, VehicleRow},
    },
    AppResult,
};

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn json_to_text(v: &Value) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "{}".to_string())
}

/* ========================================================================= *
 *                              FRESHNESS                                    *
 * ========================================================================= */

pub fn mark_fresh(pool: &DbPool, cache_name: &str, ttl_seconds: u64) -> AppResult<()> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO cache_freshness (cache_name, fetched_at, ttl_seconds, is_stale)
         VALUES (?1, ?2, ?3, 0)
         ON CONFLICT(cache_name) DO UPDATE SET
            fetched_at  = excluded.fetched_at,
            ttl_seconds = excluded.ttl_seconds,
            is_stale    = 0",
        params![cache_name, now_iso(), ttl_seconds as i64],
    )?;
    Ok(())
}

pub fn freshness_all(pool: &DbPool) -> AppResult<Vec<CacheFreshnessRow>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT cache_name, fetched_at, ttl_seconds, is_stale
         FROM cache_freshness
         ORDER BY cache_name",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(CacheFreshnessRow {
                cache_name: r.get(0)?,
                fetched_at: r.get(1)?,
                ttl_seconds: r.get(2)?,
                is_stale: r.get::<_, i64>(3)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/* ========================================================================= *
 *                          VEHICLES + DRIVERS UPSERT                        *
 * ========================================================================= */

pub fn upsert_vehicles_and_drivers(
    pool: &DbPool,
    vehicles: &[CachedVehicle],
    drivers: &[CachedDriver],
) -> AppResult<usize> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let fetched = now_iso();

    let mut inserted = 0;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO vehicles_cache (
                id, car_no_plate, car_type, transporter, tank_capacity,
                json_compartments, license_expiration_date, calibration_expiration_date,
                tank_license_expiration_date, is_in_trip, is_approved, location, lat, long,
                location_time_stamp, engine_status, speed, last_fuel_odometer,
                last_oil_change_id, driver_id, operating_company, operating_area, geo_fence,
                slack_status, last_updated_slack_status, etit_car_id,
                car_license_url, car_license_back_url,
                calibration_license_url, calibration_license_back_url,
                tank_license_url, tank_license_back_url,
                raw_payload, source_created_at, source_updated_at, source_deleted_at,
                fetched_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5,
                ?6, ?7, ?8,
                ?9, ?10, ?11, ?12, ?13, ?14,
                ?15, ?16, ?17, ?18,
                ?19, ?20, ?21, ?22, ?23,
                ?24, ?25, ?26,
                ?27, ?28,
                ?29, ?30,
                ?31, ?32,
                ?33, ?34, ?35, ?36,
                ?37
             )
             ON CONFLICT(id) DO UPDATE SET
                car_no_plate = excluded.car_no_plate,
                car_type = excluded.car_type,
                transporter = excluded.transporter,
                tank_capacity = excluded.tank_capacity,
                json_compartments = excluded.json_compartments,
                license_expiration_date = excluded.license_expiration_date,
                calibration_expiration_date = excluded.calibration_expiration_date,
                tank_license_expiration_date = excluded.tank_license_expiration_date,
                is_in_trip = excluded.is_in_trip,
                is_approved = excluded.is_approved,
                location = excluded.location,
                lat = excluded.lat,
                long = excluded.long,
                location_time_stamp = excluded.location_time_stamp,
                engine_status = excluded.engine_status,
                speed = excluded.speed,
                last_fuel_odometer = excluded.last_fuel_odometer,
                last_oil_change_id = excluded.last_oil_change_id,
                driver_id = excluded.driver_id,
                operating_company = excluded.operating_company,
                operating_area = excluded.operating_area,
                geo_fence = excluded.geo_fence,
                slack_status = excluded.slack_status,
                last_updated_slack_status = excluded.last_updated_slack_status,
                etit_car_id = excluded.etit_car_id,
                car_license_url = excluded.car_license_url,
                car_license_back_url = excluded.car_license_back_url,
                calibration_license_url = excluded.calibration_license_url,
                calibration_license_back_url = excluded.calibration_license_back_url,
                tank_license_url = excluded.tank_license_url,
                tank_license_back_url = excluded.tank_license_back_url,
                raw_payload = excluded.raw_payload,
                source_created_at = excluded.source_created_at,
                source_updated_at = excluded.source_updated_at,
                source_deleted_at = excluded.source_deleted_at,
                fetched_at = excluded.fetched_at",
        )?;

        for v in vehicles {
            stmt.execute(params![
                v.id,
                v.car_no_plate,
                v.car_type,
                v.transporter,
                v.tank_capacity,
                v.json_compartments.as_ref().map(json_to_text),
                v.license_expiration_date,
                v.calibration_expiration_date,
                v.tank_license_expiration_date,
                v.is_in_trip.unwrap_or(false) as i64,
                v.is_approved.unwrap_or(false) as i64,
                v.location,
                v.lat,
                v.lng,
                v.location_time_stamp,
                v.engine_status,
                v.speed,
                v.last_fuel_odometer,
                v.last_oil_change_id,
                v.driver_id,
                v.operating_company,
                v.operating_area,
                v.geo_fence,
                v.slack_status,
                v.last_updated_slack_status,
                v.etit_car_id,
                v.car_license_url,
                v.car_license_back_url,
                v.calibration_license_url,
                v.calibration_license_back_url,
                v.tank_license_url,
                v.tank_license_back_url,
                json_to_text(&v.raw_payload),
                v.source_created_at,
                v.source_updated_at,
                v.source_deleted_at,
                fetched,
            ])?;
            inserted += 1;
        }
    }

    {
        let mut stmt = tx.prepare(
            "INSERT INTO drivers_cache (
                id, name, mobile_number, transporter,
                id_license_expiration_date, driver_license_expiration_date,
                safety_license_expiration_date, drug_test_expiration_date,
                is_approved, raw_payload, source_created_at, source_updated_at, fetched_at
             ) VALUES (
                ?1, ?2, ?3, ?4,
                ?5, ?6,
                ?7, ?8,
                ?9, ?10, ?11, ?12, ?13
             )
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                mobile_number = excluded.mobile_number,
                transporter = excluded.transporter,
                id_license_expiration_date = excluded.id_license_expiration_date,
                driver_license_expiration_date = excluded.driver_license_expiration_date,
                safety_license_expiration_date = excluded.safety_license_expiration_date,
                drug_test_expiration_date = excluded.drug_test_expiration_date,
                is_approved = excluded.is_approved,
                raw_payload = excluded.raw_payload,
                source_created_at = excluded.source_created_at,
                source_updated_at = excluded.source_updated_at,
                fetched_at = excluded.fetched_at",
        )?;

        for d in drivers {
            stmt.execute(params![
                d.id,
                d.name,
                d.mobile_number,
                d.transporter,
                d.id_license_expiration_date,
                d.driver_license_expiration_date,
                d.safety_license_expiration_date,
                d.drug_test_expiration_date,
                d.is_approved.unwrap_or(false) as i64,
                json_to_text(&d.raw_payload),
                d.source_created_at,
                d.source_updated_at,
                fetched,
            ])?;
        }
    }

    tx.commit()?;
    Ok(inserted)
}

/* ========================================================================= *
 *                          INVOICES + ITEMS UPSERT                          *
 * ========================================================================= */

pub fn upsert_invoices(pool: &DbPool, invoices: &[CachedInvoice]) -> AppResult<usize> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let fetched = now_iso();

    let mut inserted = 0;
    {
        let mut inv_stmt = tx.prepare(
            "INSERT INTO service_invoices_cache (
                id, car_id, driver_name, date, meter_reading,
                plate_number, supervisor, operating_region,
                raw_payload, source_created_at, source_updated_at, source_deleted_at,
                fetched_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5,
                ?6, ?7, ?8,
                ?9, ?10, ?11, ?12,
                ?13
             )
             ON CONFLICT(id) DO UPDATE SET
                car_id = excluded.car_id,
                driver_name = excluded.driver_name,
                date = excluded.date,
                meter_reading = excluded.meter_reading,
                plate_number = excluded.plate_number,
                supervisor = excluded.supervisor,
                operating_region = excluded.operating_region,
                raw_payload = excluded.raw_payload,
                source_created_at = excluded.source_created_at,
                source_updated_at = excluded.source_updated_at,
                source_deleted_at = excluded.source_deleted_at,
                fetched_at = excluded.fetched_at",
        )?;

        let mut item_del = tx.prepare(
            "DELETE FROM service_invoice_items_cache WHERE service_invoice_id = ?1",
        )?;
        let mut item_ins = tx.prepare(
            "INSERT INTO service_invoice_items_cache (
                id, service_invoice_id, service, notes, item_order,
                raw_payload, source_created_at, source_updated_at, fetched_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )?;

        for inv in invoices {
            let car_id = inv.effective_car_id();
            let plate = inv.effective_plate();

            inv_stmt.execute(params![
                inv.id,
                car_id.unwrap_or(0),
                inv.driver_name,
                inv.date,
                inv.meter_reading,
                plate,
                inv.supervisor,
                inv.operating_region,
                json_to_text(&inv.raw_payload),
                inv.source_created_at,
                inv.source_updated_at,
                inv.source_deleted_at,
                fetched,
            ])?;

            item_del.execute(params![inv.id])?;
            for item in &inv.items {
                let item_invoice_id = item.service_invoice_id.unwrap_or(inv.id);
                item_ins.execute(params![
                    item.id,
                    item_invoice_id,
                    item.service,
                    item.notes,
                    item.item_order,
                    json_to_text(&item.raw_payload),
                    item.source_created_at,
                    item.source_updated_at,
                    fetched,
                ])?;
            }
            inserted += 1;
        }
    }

    tx.commit()?;
    Ok(inserted)
}

/* ========================================================================= *
 *                             READ-SIDE QUERIES                             *
 * ========================================================================= */

pub fn list_vehicles(pool: &DbPool) -> AppResult<Vec<VehicleRow>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT v.id, v.car_no_plate, v.car_type, v.transporter, v.tank_capacity,
                v.last_fuel_odometer, v.driver_id, d.name AS driver_name,
                v.license_expiration_date, v.calibration_expiration_date,
                v.tank_license_expiration_date,
                v.is_in_trip, v.is_approved, v.source_deleted_at, v.fetched_at
         FROM vehicles_cache v
         LEFT JOIN drivers_cache d ON d.id = v.driver_id
         WHERE v.source_deleted_at IS NULL
         ORDER BY v.car_no_plate",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(VehicleRow {
                id: r.get(0)?,
                car_no_plate: r.get(1)?,
                car_type: r.get(2)?,
                transporter: r.get(3)?,
                tank_capacity: r.get(4)?,
                last_fuel_odometer: r.get(5)?,
                driver_id: r.get(6)?,
                driver_name: r.get(7)?,
                license_expiration_date: r.get(8)?,
                calibration_expiration_date: r.get(9)?,
                tank_license_expiration_date: r.get(10)?,
                is_in_trip: r.get::<_, i64>(11)? != 0,
                is_approved: r.get::<_, i64>(12)? != 0,
                source_deleted_at: r.get(13)?,
                fetched_at: r.get(14)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn list_drivers(pool: &DbPool) -> AppResult<Vec<DriverRow>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, mobile_number, transporter,
                id_license_expiration_date, driver_license_expiration_date,
                is_approved, fetched_at
         FROM drivers_cache
         ORDER BY name",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(DriverRow {
                id: r.get(0)?,
                name: r.get(1)?,
                mobile_number: r.get(2)?,
                transporter: r.get(3)?,
                id_license_expiration_date: r.get(4)?,
                driver_license_expiration_date: r.get(5)?,
                is_approved: r.get::<_, i64>(6)? != 0,
                fetched_at: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Lists invoices, optionally filtered by vehicle id. Pagination is server-
/// like (page,limit) so the same call covers both the "all invoices" and
/// "all invoices for this vehicle" pages.
pub fn list_invoices(
    pool: &DbPool,
    car_id: Option<i64>,
    page: i32,
    limit: i32,
) -> AppResult<InvoiceListResult> {
    let conn = pool.get()?;
    let offset = ((page.max(1) - 1) * limit.max(1)) as i64;

    let (total, rows) = if let Some(cid) = car_id {
        let total: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM service_invoices_cache
                 WHERE source_deleted_at IS NULL AND car_id = ?1",
                params![cid],
                |r| r.get(0),
            )
            .unwrap_or(0);

        let mut stmt = conn.prepare(
            "SELECT i.id, i.car_id, i.date, i.plate_number, i.driver_name,
                    i.supervisor, i.operating_region, i.meter_reading,
                    (SELECT COUNT(*) FROM service_invoice_items_cache it WHERE it.service_invoice_id = i.id) AS item_count,
                    (SELECT GROUP_CONCAT(s.service, ' • ') FROM (
                         SELECT service FROM service_invoice_items_cache
                         WHERE service_invoice_id = i.id
                         ORDER BY COALESCE(item_order, id) LIMIT 3
                     ) s) AS preview,
                    i.fetched_at
             FROM service_invoices_cache i
             WHERE i.source_deleted_at IS NULL AND i.car_id = ?1
             ORDER BY i.date DESC, i.id DESC
             LIMIT ?2 OFFSET ?3",
        )?;
        let rows = stmt
            .query_map(params![cid, limit as i64, offset], map_invoice_row)?
            .collect::<Result<Vec<_>, _>>()?;
        (total, rows)
    } else {
        let total: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM service_invoices_cache WHERE source_deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        let mut stmt = conn.prepare(
            "SELECT i.id, i.car_id, i.date, i.plate_number, i.driver_name,
                    i.supervisor, i.operating_region, i.meter_reading,
                    (SELECT COUNT(*) FROM service_invoice_items_cache it WHERE it.service_invoice_id = i.id) AS item_count,
                    (SELECT GROUP_CONCAT(s.service, ' • ') FROM (
                         SELECT service FROM service_invoice_items_cache
                         WHERE service_invoice_id = i.id
                         ORDER BY COALESCE(item_order, id) LIMIT 3
                     ) s) AS preview,
                    i.fetched_at
             FROM service_invoices_cache i
             WHERE i.source_deleted_at IS NULL
             ORDER BY i.date DESC, i.id DESC
             LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt
            .query_map(params![limit as i64, offset], map_invoice_row)?
            .collect::<Result<Vec<_>, _>>()?;
        (total, rows)
    };

    Ok(InvoiceListResult {
        rows,
        total,
        page,
        limit,
    })
}

pub fn get_invoice(pool: &DbPool, id: i64) -> AppResult<Option<InvoiceDetail>> {
    let conn = pool.get()?;

    let header_opt = conn
        .query_row(
            "SELECT i.id, i.car_id, i.date, i.plate_number, i.driver_name,
                    i.supervisor, i.operating_region, i.meter_reading, i.fetched_at,
                    v.id, v.car_no_plate, v.car_type, v.transporter, v.tank_capacity
             FROM service_invoices_cache i
             LEFT JOIN vehicles_cache v ON v.id = i.car_id
             WHERE i.id = ?1 AND i.source_deleted_at IS NULL",
            params![id],
            |r| {
                let veh_id: Option<i64> = r.get(9)?;
                let car = match veh_id {
                    Some(vid) => Some(InvoiceCarInfo {
                        id: vid,
                        car_no_plate: r.get::<_, Option<String>>(10)?.unwrap_or_default(),
                        car_type: r.get(11)?,
                        transporter: r.get(12)?,
                        tank_capacity: r.get(13)?,
                    }),
                    None => None,
                };
                Ok(InvoiceDetail {
                    id: r.get(0)?,
                    car_id: r.get(1)?,
                    date: r.get(2)?,
                    plate_number: r.get(3)?,
                    driver_name: r.get(4)?,
                    supervisor: r.get(5)?,
                    operating_region: r.get(6)?,
                    meter_reading: r.get(7)?,
                    fetched_at: r.get(8)?,
                    car,
                    items: Vec::new(),
                })
            },
        )
        .optional()?;

    let mut detail = match header_opt {
        Some(d) => d,
        None => return Ok(None),
    };

    let mut stmt = conn.prepare(
        "SELECT id, service, notes, item_order
         FROM service_invoice_items_cache
         WHERE service_invoice_id = ?1
         ORDER BY COALESCE(item_order, id)",
    )?;
    detail.items = stmt
        .query_map(params![id], |r| {
            Ok(InvoiceItemRow {
                id: r.get(0)?,
                service: r.get(1)?,
                notes: r.get(2)?,
                item_order: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Some(detail))
}

pub fn search_invoices_offline(
    pool: &DbPool,
    query: &str,
    car_id: Option<i64>,
    limit: i32,
) -> AppResult<InvoiceSearchResult> {
    let conn = pool.get()?;

    let match_query = sanitize_fts5_query(query);
    if match_query.is_empty() {
        return Ok(InvoiceSearchResult {
            rows: Vec::new(),
            source: SearchSource::Offline,
            total: 0,
            query: query.to_string(),
        });
    }

    let (total, rows) = if let Some(cid) = car_id {
        let total: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT it.service_invoice_id)
                 FROM service_invoice_items_fts f
                 JOIN service_invoice_items_cache it ON it.id = f.rowid
                 JOIN service_invoices_cache i ON i.id = it.service_invoice_id
                 WHERE service_invoice_items_fts MATCH ?1 
                   AND i.source_deleted_at IS NULL
                   AND i.car_id = ?2",
                params![&match_query, cid],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(0);

        let mut stmt = conn.prepare(
            "SELECT i.id, i.car_id, i.date, i.plate_number, i.driver_name,
                    i.supervisor, i.operating_region, i.meter_reading,
                    (SELECT COUNT(*) FROM service_invoice_items_cache it2 WHERE it2.service_invoice_id = i.id) AS item_count,
                    (SELECT GROUP_CONCAT(s.service, ' • ') FROM (
                         SELECT service FROM service_invoice_items_cache
                         WHERE service_invoice_id = i.id
                         ORDER BY COALESCE(item_order, id) LIMIT 3
                     ) s) AS preview,
                    i.fetched_at
             FROM (
                 SELECT DISTINCT it.service_invoice_id AS id
                 FROM service_invoice_items_fts f
                 JOIN service_invoice_items_cache it ON it.id = f.rowid
                 WHERE service_invoice_items_fts MATCH ?1
             ) m
             JOIN service_invoices_cache i ON i.id = m.id
             WHERE i.source_deleted_at IS NULL AND i.car_id = ?2
             ORDER BY i.date DESC, i.id DESC
             LIMIT ?3",
        )?;
        let rows = stmt
            .query_map(params![&match_query, cid, limit as i64], map_invoice_row)?
            .collect::<Result<Vec<_>, _>>()?;
        (total, rows)
    } else {
        let total: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT it.service_invoice_id)
                 FROM service_invoice_items_fts f
                 JOIN service_invoice_items_cache it ON it.id = f.rowid
                 JOIN service_invoices_cache i ON i.id = it.service_invoice_id
                 WHERE service_invoice_items_fts MATCH ?1 AND i.source_deleted_at IS NULL",
                params![&match_query],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(0);

        let mut stmt = conn.prepare(
            "SELECT i.id, i.car_id, i.date, i.plate_number, i.driver_name,
                    i.supervisor, i.operating_region, i.meter_reading,
                    (SELECT COUNT(*) FROM service_invoice_items_cache it2 WHERE it2.service_invoice_id = i.id) AS item_count,
                    (SELECT GROUP_CONCAT(s.service, ' • ') FROM (
                         SELECT service FROM service_invoice_items_cache
                         WHERE service_invoice_id = i.id
                         ORDER BY COALESCE(item_order, id) LIMIT 3
                     ) s) AS preview,
                    i.fetched_at
             FROM (
                 SELECT DISTINCT it.service_invoice_id AS id
                 FROM service_invoice_items_fts f
                 JOIN service_invoice_items_cache it ON it.id = f.rowid
                 WHERE service_invoice_items_fts MATCH ?1
             ) m
             JOIN service_invoices_cache i ON i.id = m.id
             WHERE i.source_deleted_at IS NULL
             ORDER BY i.date DESC, i.id DESC
             LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![&match_query, limit as i64], map_invoice_row)?
            .collect::<Result<Vec<_>, _>>()?;
        (total, rows)
    };

    Ok(InvoiceSearchResult {
        rows,
        source: SearchSource::Offline,
        total,
        query: query.to_string(),
    })
}

fn map_invoice_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<InvoiceRow> {
    Ok(InvoiceRow {
        id: r.get(0)?,
        car_id: r.get(1)?,
        date: r.get(2)?,
        plate_number: r.get(3)?,
        driver_name: r.get(4)?,
        supervisor: r.get(5)?,
        operating_region: r.get(6)?,
        meter_reading: r.get(7)?,
        item_count: r.get(8)?,
        services_preview: r.get(9)?,
        fetched_at: r.get(10)?,
    })
}

fn sanitize_fts5_query(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '"' | '\'' | '*' | ':' | '^' | '(' | ')' => ' ',
            _ => c,
        })
        .collect();

    let tokens: Vec<String> = cleaned
        .split_whitespace()
        .filter(|t| t.chars().any(|c| c.is_alphanumeric()))
        .map(|t| format!("\"{}\"*", t))
        .collect();

    tokens.join(" ")
}

#[cfg(test)]
mod tests {
    use super::sanitize_fts5_query;

    #[test]
    fn fts_sanitizer_strips_punctuation_and_appends_prefix_wildcard() {
        assert_eq!(sanitize_fts5_query("فرامل"), "\"فرامل\"*");
        assert_eq!(sanitize_fts5_query("front brake"), "\"front\"* \"brake\"*");
        assert_eq!(sanitize_fts5_query("\"odd*input\""), "\"odd\"* \"input\"*");
        assert_eq!(sanitize_fts5_query("   "), "");
    }
}
