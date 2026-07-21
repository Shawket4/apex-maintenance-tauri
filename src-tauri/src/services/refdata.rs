//! Reference + stock mirror replacement.
//!
//! Categories, vehicle classes, service plans and the two stock ledgers are
//! small server-owned tables. They are refreshed by wholesale replacement
//! (like vehicles_cache), never sync-pulled and never written locally —
//! the commands layer fetches JSON online and hands it here; this module
//! only touches SQLite.

use rusqlite::params;
use serde_json::Value;

use crate::db::DbPool;
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
