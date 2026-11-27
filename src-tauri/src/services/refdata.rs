//! Reference + stock mirror replacement.
//!
//! Categories, vehicle classes, service plans and the two stock ledgers are
//! small server-owned tables. They are refreshed by wholesale replacement
//! (like vehicles_cache), never sync-pulled and never written locally —
//! the commands layer fetches JSON online and hands it here; this module
//! only touches SQLite.

use std::collections::HashSet;

use rusqlite::params;
use serde_json::Value;

use crate::db::DbPool;
use crate::services::domain::norm_key;
use crate::AppResult;

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(String::from)
}
fn i(v: &Value, k: &str) -> Option<i64> {
    v.get(k).and_then(|x| x.as_i64())
}
fn f(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(|x| x.as_f64())
}
fn b(v: &Value, k: &str) -> bool {
    v.get(k).and_then(|x| x.as_bool()).unwrap_or(false)
}

pub fn replace_categories(pool: &DbPool, rows: &[Value]) -> AppResult<usize> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM maintenance_categories", [])?;
    for r in rows {
        tx.execute(
            "INSERT INTO maintenance_categories (id, name_ar, name_en, icon, color, sort_order)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                s(r, "id"),
                s(r, "name_ar").unwrap_or_default(),
                s(r, "name_en").unwrap_or_default(),
                s(r, "icon"),
                s(r, "color"),
                i(r, "sort_order").unwrap_or(0)
            ],
        )?;
    }
    // A type typed in here that the server has not created yet stays listed.
    tx.execute(
        "INSERT OR IGNORE INTO maintenance_categories (id, name_ar, name_en, sort_order)
         SELECT category_id, MAX(category_name_ar), MAX(category_name_ar), 1000 FROM work_order_tasks
          WHERE category_id LIKE 'c-%' AND category_name_ar IS NOT NULL AND deleted_at IS NULL
          GROUP BY category_id",
        [],
    )?;
    tx.commit()?;
    Ok(rows.len())
}

pub fn replace_classes(pool: &DbPool, rows: &[Value]) -> AppResult<usize> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM vehicle_classes", [])?;
    for r in rows {
        tx.execute(
            "INSERT INTO vehicle_classes (id, name_ar, name_en, sort_order) VALUES (?1,?2,?3,?4)",
            params![
                s(r, "id"),
                s(r, "name_ar").unwrap_or_default(),
                s(r, "name_en").unwrap_or_default(),
                i(r, "sort_order").unwrap_or(0)
            ],
        )?;
    }
    tx.commit()?;
    Ok(rows.len())
}

pub fn replace_plans(pool: &DbPool, rows: &[Value]) -> AppResult<usize> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM service_plans", [])?;
    for r in rows {
        tx.execute(
            "INSERT INTO service_plans
               (id, class_id, category_id, trigger_type, interval_km, interval_days,
                lead_warn_km, lead_warn_days, is_active, deleted_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                s(r, "id"),
                s(r, "class_id"),
                s(r, "category_id"),
                s(r, "trigger_type"),
                i(r, "interval_km"),
                i(r, "interval_days"),
                i(r, "lead_warn_km"),
                i(r, "lead_warn_days"),
                b(r, "is_active") as i64,
                s(r, "deleted_at")
            ],
        )?;
    }
    tx.commit()?;
    Ok(rows.len())
}

pub fn replace_tire_stock(pool: &DbPool, rows: &[Value]) -> AppResult<usize> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM tire_stock_cache", [])?;
    for r in rows {
        tx.execute(
            "INSERT INTO tire_stock_cache (id, brand, model, size, on_hand_qty, fetched_at)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                s(r, "id"),
                s(r, "brand").unwrap_or_default(),
                s(r, "model"),
                s(r, "size"),
                i(r, "on_hand_qty").unwrap_or(0),
                s(r, "fetched_at")
            ],
        )?;
    }
    tx.commit()?;
    Ok(rows.len())
}

/// Battery stock is counted by maint-rust alone (GET /stock/batteries).
pub fn replace_battery_stock(pool: &DbPool, rows: &[Value]) -> AppResult<usize> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM battery_stock_cache", [])?;
    let now = crate::services::domain::now_iso();
    for r in rows {
        tx.execute(
            "INSERT OR REPLACE INTO battery_stock_cache (id, brand, model, capacity_ah, voltage, cca, on_hand_qty, fetched_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                s(r, "id"),
                s(r, "brand").unwrap_or_default(),
                s(r, "model").filter(|m| !m.is_empty()),
                i(r, "capacity_ah"),
                i(r, "voltage"),
                i(r, "cca"),
                i(r, "on_hand_qty").unwrap_or(0),
                now
            ],
        )?;
    }
    tx.commit()?;
    Ok(rows.len())
}

pub fn replace_oil_stock(pool: &DbPool, rows: &[Value]) -> AppResult<usize> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM oil_stock_cache", [])?;
    for r in rows {
        tx.execute(
            "INSERT INTO oil_stock_cache (id, oil_type, liters_on_hand, fetched_at)
             VALUES (?1,?2,?3,?4)",
            params![
                s(r, "id"),
                s(r, "oil_type").unwrap_or_default(),
                f(r, "liters_on_hand").unwrap_or(0.0),
                s(r, "fetched_at")
            ],
        )?;
    }
    tx.commit()?;
    Ok(rows.len())
}

/// Replace the three catalog mirrors from GET /catalog.
pub fn replace_catalog(pool: &DbPool, v: &Value) -> AppResult<()> {
    let empty: Vec<Value> = Vec::new();
    let list = |k: &str| v.get(k).and_then(|x| x.as_array()).unwrap_or(&empty).clone();
    // Not our envelope: leave the mirrors alone rather than empty them.
    if !["tire_products", "oil_products", "standard_jobs"].iter().all(|k| v.get(*k).map(|x| x.is_array()).unwrap_or(false)) {
        return Err(crate::AppError::Http("unexpected answer for /catalog".into()));
    }
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM tire_products", [])?;
    for r in list("tire_products") {
        tx.execute(
            "INSERT OR REPLACE INTO tire_products (id, brand, model, size, tires, on_hand) VALUES (?1,?2,?3,?4,?5,?6)",
            params![s(&r, "id"), s(&r, "brand").unwrap_or_default(), s(&r, "model").unwrap_or_default(),
                    s(&r, "size").unwrap_or_default(), i(&r, "tires").unwrap_or(0), i(&r, "on_hand")],
        )?;
    }
    tx.execute("DELETE FROM oil_products", [])?;
    for r in list("oil_products") {
        tx.execute(
            "INSERT OR REPLACE INTO oil_products (id, name, uses, on_hand) VALUES (?1,?2,?3,?4)",
            params![s(&r, "id"), s(&r, "name").unwrap_or_default(), i(&r, "uses").unwrap_or(0), f(&r, "on_hand")],
        )?;
    }
    // A job typed here on a task not sent yet stays offered until the server,
    // told of the task, lists it (it learns jobs from tasks).
    let typed_here: Vec<(String, String, Option<String>)> = {
        let mut stmt = tx.prepare(
            "SELECT j.id, j.name_ar, j.category_id FROM standard_jobs j
              WHERE j.id LIKE 'local-%' AND EXISTS (
                    SELECT 1 FROM work_order_tasks t
                      JOIN outbox o ON o.entity_type = 'work_order_tasks' AND o.entity_id = t.id
                     WHERE o.status IN ('pending','inflight') AND t.description_ar = j.name_ar)",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<Vec<_>, _>>()?;
        rows
    };
    tx.execute("DELETE FROM standard_jobs", [])?;
    let mut listed = HashSet::new();
    for r in list("standard_jobs") {
        listed.insert(norm_key(&s(&r, "name_ar").unwrap_or_default()));
        tx.execute(
            "INSERT OR REPLACE INTO standard_jobs (id, name_ar, name_en, category_id, uses) VALUES (?1,?2,?3,?4,?5)",
            params![s(&r, "id"), s(&r, "name_ar").unwrap_or_default(), s(&r, "name_en"), s(&r, "category_id"), i(&r, "uses").unwrap_or(0)],
        )?;
    }
    // Batteries arrived with maint-rust 0031: an older server sends none, and
    // then the list is simply left as it was.
    if let Some(rows) = v.get("battery_products").and_then(|x| x.as_array()) {
        tx.execute("DELETE FROM battery_products", [])?;
        for r in rows {
            tx.execute(
                "INSERT OR REPLACE INTO battery_products (id, brand, model, capacity_ah, voltage, cca, batteries, on_hand)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![s(r, "id"), s(r, "brand").unwrap_or_default(), s(r, "model"), i(r, "capacity_ah"),
                        i(r, "voltage"), i(r, "cca"), i(r, "batteries").unwrap_or(0), i(r, "on_hand")],
            )?;
        }
    }
    for (id, name, category) in typed_here {
        if !listed.contains(&norm_key(&name)) {
            tx.execute(
                "INSERT OR IGNORE INTO standard_jobs (id, name_ar, category_id, uses) VALUES (?1, ?2, ?3, 0)",
                params![id, name, category],
            )?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Replace the old-invoice history mirror from GET /legacy-events.
pub fn replace_legacy_events(pool: &DbPool, rows: &[Value]) -> AppResult<()> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM legacy_events", [])?;
    for r in rows {
        let (Some(id), Some(vehicle), Some(cat), Some(at)) = (i(r, "id"), i(r, "vehicle_id"), s(r, "category_id"), s(r, "done_at")) else {
            continue;
        };
        tx.execute(
            "INSERT OR REPLACE INTO legacy_events (id, vehicle_id, category_id, done_at, km) VALUES (?1,?2,?3,?4,?5)",
            params![id, vehicle, cat, at, i(r, "km")],
        )?;
    }
    tx.commit()?;
    Ok(())
}
