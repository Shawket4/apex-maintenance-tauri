//! The stock movements ledger, LOCAL-first: reads (filter / time-range /
//! pagination) run against the `stock_movements_cache` mirror so they work
//! offline; an online refresh upserts the latest window from maint-rust.
//!
//! Movements are the server-owned ledger (debits from oil changes and
//! shipment-tire mounts, credits from the dashboard) mirrored to Falcon; the
//! client keeps a bounded recent window locally purely so the view is usable
//! without a connection.

use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::AppResult;

/// One row of the ledger. `kind` is tire_debit | oil_debit | tire_credit |
/// oil_credit | adjustment; tires carry qty, oil carries liters; a debit
/// resolves the consuming work order's plate.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct StockMovementRow {
    pub id: String,
    pub kind: String,
    pub brand: Option<String>,
    pub model: Option<String>,
    pub size: Option<String>,
    pub oil_type: Option<String>,
    pub qty: Option<i64>,
    pub liters: Option<f64>,
    pub work_order_id: Option<String>,
    pub plate: Option<String>,
    pub created_at: String,
    pub mirrored: bool,
}

/// Upsert a window of movements (the server's JSON array) into the local
/// mirror. Movements are immutable except `mirrored`/`plate`, so a re-pull of
/// the same id just refreshes those.
pub fn upsert(conn: &mut Connection, rows: &[Value]) -> AppResult<usize> {
    let tx = conn.transaction()?;
    let mut n = 0usize;
    for row in rows {
        let Some(id) = row.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let s = |k: &str| row.get(k).and_then(|v| v.as_str()).map(str::to_string);
        let kind = match row.get("kind").and_then(|v| v.as_str()) {
            Some(k) => k.to_string(),
            None => continue,
        };
        let created_at = match row.get("created_at").and_then(|v| v.as_str()) {
            Some(c) => c.to_string(),
            None => continue,
        };
        let qty = row.get("qty").and_then(|v| v.as_i64());
        let liters = row.get("liters").and_then(|v| v.as_f64());
        let mirrored = row.get("mirrored").and_then(|v| v.as_bool()).unwrap_or(false);
        tx.execute(
            "INSERT INTO stock_movements_cache
               (id, kind, brand, model, size, oil_type, qty, liters, work_order_id, plate,
                created_at, mirrored, fetched_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
               mirrored = excluded.mirrored, plate = excluded.plate, fetched_at = excluded.fetched_at",
            params![
                id, kind, s("brand"), s("model"), s("size"), s("oil_type"), qty, liters,
                s("work_order_id"), s("plate"), created_at, mirrored as i64
            ],
        )?;
        n += 1;
    }
    tx.commit()?;
    Ok(n)
}

/// Local, offline-safe read: filter by kind (tire|oil), an inclusive `from`
/// date/timestamp lower bound (created_at is stored as the server's ISO string,
/// which is lexically ordered), newest first, paginated.
pub fn list(
    conn: &Connection,
    kind: Option<&str>,
    from: Option<&str>,
    limit: i64,
    offset: i64,
) -> AppResult<Vec<StockMovementRow>> {
    let mut sql = String::from(
        "SELECT id, kind, brand, model, size, oil_type, qty, liters, work_order_id, plate,
                created_at, mirrored
           FROM stock_movements_cache WHERE 1=1",
    );
    // kind is inlined from a fixed set — never user text.
    match kind {
        Some("tire") => sql.push_str(" AND kind IN ('tire_debit','tire_credit')"),
        Some("oil") => sql.push_str(" AND kind IN ('oil_debit','oil_credit')"),
        _ => {}
    }
    let mut binds: Vec<SqlValue> = Vec::new();
    if let Some(f) = from {
        sql.push_str(" AND created_at >= ?");
        binds.push(SqlValue::Text(f.to_string()));
    }
    sql.push_str(" ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?");
    binds.push(SqlValue::Integer(limit));
    binds.push(SqlValue::Integer(offset));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params_from_iter(binds), |r| {
            Ok(StockMovementRow {
                id: r.get(0)?,
                kind: r.get(1)?,
                brand: r.get(2)?,
                model: r.get(3)?,
                size: r.get(4)?,
                oil_type: r.get(5)?,
                qty: r.get(6)?,
                liters: r.get(7)?,
                work_order_id: r.get(8)?,
                plate: r.get(9)?,
                created_at: r.get(10)?,
                mirrored: r.get::<_, i64>(11)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../migrations/0010_stock_movements_cache.sql")).unwrap();
        c
    }

    fn mv(id: &str, kind: &str, day: &str) -> Value {
        json!({ "id": id, "kind": kind, "brand": "Michelin", "size": "315/80R22.5",
                "qty": 1, "created_at": format!("2026-08-{day}T10:00:00+00:00"), "mirrored": false })
    }

    #[test]
    fn upsert_is_idempotent_and_list_filters_paginates() {
        let mut c = mem();
        let rows: Vec<Value> = (1..=12)
            .map(|i| mv(&format!("t{i}"), if i % 2 == 0 { "oil_debit" } else { "tire_debit" }, &format!("{:02}", i)))
            .collect();
        assert_eq!(upsert(&mut c, &rows).unwrap(), 12);
        // re-upsert same ids → no duplicates.
        upsert(&mut c, &rows).unwrap();
        let all = list(&c, None, None, 100, 0).unwrap();
        assert_eq!(all.len(), 12, "upsert must be idempotent on id");

        // newest first (day 12 before day 01).
        assert_eq!(all[0].created_at, "2026-08-12T10:00:00+00:00");

        // kind filter.
        assert_eq!(list(&c, Some("oil"), None, 100, 0).unwrap().len(), 6);
        assert_eq!(list(&c, Some("tire"), None, 100, 0).unwrap().len(), 6);

        // time-range: from day 07 inclusive → days 07..12 = 6 rows.
        assert_eq!(list(&c, None, Some("2026-08-07"), 100, 0).unwrap().len(), 6);

        // pagination: page size 5.
        let p1 = list(&c, None, None, 5, 0).unwrap();
        let p2 = list(&c, None, None, 5, 5).unwrap();
        let p3 = list(&c, None, None, 5, 10).unwrap();
        assert_eq!((p1.len(), p2.len(), p3.len()), (5, 5, 2));
        // no overlap across pages.
        assert_ne!(p1[0].id, p2[0].id);
    }
}
