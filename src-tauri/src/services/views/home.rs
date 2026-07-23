//! Home summary + stock projection (snapshot − queued debits).


use serde::Serialize;

use crate::db::DbPool;
use crate::services::outbox;
use crate::AppResult;

use super::*;

// ═════════════════════════════ home ══════════════════════════════════════════

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct StockTireLine {
    pub id: String,
    pub brand: String,
    pub model: Option<String>,
    pub size: Option<String>,
    pub snapshot_qty: i64,
    pub pending_debits: i64,
    pub projected_qty: i64,
    /// projected_qty at or below the reorder threshold — computed HERE so the
    /// cutoff exists in exactly one place (React styles off this flag).
    pub low_stock: bool,
    pub fetched_at: Option<String>,
}

/// Reorder thresholds. The one home of these numbers.
pub const K_LOW_STOCK_TIRES: i64 = 4;
pub const K_LOW_STOCK_OIL_LITERS: f64 = 72.0; // ≈ two fills

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct StockOilLine {
    pub id: String,
    pub oil_type: String,
    pub snapshot_liters: f64,
    pub pending_liters: f64,
    pub projected_liters: f64,
    pub low_stock: bool,
    pub fetched_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct StockView {
    pub tires: Vec<StockTireLine>,
    pub oil: Vec<StockOilLine>,
    /// Used tires available to mount (individual assets in the pool).
    pub used_pool_count: i64,
}

/// Projected on-hand = last server snapshot − debits still queued locally.
/// Queued oil debits = local oil_changes rows whose outbox op isn't acked;
/// queued tire debits = shipment-origin tire inserts not yet acked.
pub fn stock_view(pool: &DbPool) -> AppResult<StockView> {
    let conn = pool.get()?;
    let pending_oil = pending_insert_ids(&conn, "oil_changes")?;
    let pending_tires = pending_insert_ids(&conn, "tires")?;

    let mut stmt = conn.prepare(
        "SELECT id, brand, model, size, on_hand_qty, fetched_at FROM tire_stock_cache ORDER BY brand, model, size",
    )?;
    let mut tires: Vec<StockTireLine> = stmt
        .query_map([], |r| {
            Ok(StockTireLine {
                id: r.get(0)?,
                brand: r.get(1)?,
                model: r.get(2)?,
                size: r.get(3)?,
                snapshot_qty: r.get(4)?,
                pending_debits: 0,
                projected_qty: 0,
                low_stock: false,
                fetched_at: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Count queued shipment-tire inserts per stock line.
    if !pending_tires.is_empty() {
        let mut stmt = conn.prepare(
            "SELECT brand, COALESCE(model,''), COALESCE(size,''), id FROM tires
              WHERE origin = 'shipment' AND deleted_at IS NULL",
        )?;
        let shipment_tires: Vec<(String, String, String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        for line in &mut tires {
            let lm = line.model.clone().unwrap_or_default();
            let ls = line.size.clone().unwrap_or_default();
            line.pending_debits = shipment_tires
                .iter()
                .filter(|(b, m, s, id)| {
                    *b == line.brand && *m == lm && *s == ls && pending_tires.contains(id)
                })
                .count() as i64;
        }
    }
    for line in &mut tires {
        line.projected_qty = line.snapshot_qty - line.pending_debits;
        line.low_stock = line.projected_qty <= K_LOW_STOCK_TIRES;
    }

    let mut stmt = conn.prepare(
        "SELECT id, oil_type, liters_on_hand, fetched_at FROM oil_stock_cache ORDER BY oil_type",
    )?;
    let mut oil: Vec<StockOilLine> = stmt
        .query_map([], |r| {
            Ok(StockOilLine {
                id: r.get(0)?,
                oil_type: r.get(1)?,
                snapshot_liters: r.get(2)?,
                pending_liters: 0.0,
                projected_liters: 0.0,
                low_stock: false,
                fetched_at: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if !pending_oil.is_empty() {
        let mut stmt = conn.prepare(
            "SELECT oil_type, liters, id FROM oil_changes WHERE deleted_at IS NULL",
        )?;
        let ocs: Vec<(String, f64, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        for line in &mut oil {
            line.pending_liters = ocs
                .iter()
                .filter(|(t, _, id)| *t == line.oil_type && pending_oil.contains(id))
                .map(|(_, l, _)| *l)
                .sum();
        }
    }
    for line in &mut oil {
        line.projected_liters = line.snapshot_liters - line.pending_liters;
        line.low_stock = line.projected_liters <= K_LOW_STOCK_OIL_LITERS;
    }

    let used_pool_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tires WHERE status = 'in_stock_used' AND deleted_at IS NULL",
        [],
        |r| r.get(0),
    )?;

    Ok(StockView { tires, oil, used_pool_count })
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DueCounts {
    pub overdue: i64,
    pub never_done: i64,
    pub due_soon: i64,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct HomeSummary {
    pub open_wos: Vec<WoListRow>,
    /// Most urgent due rows (overdue + never_done), capped for the strip.
    pub attention: Vec<DueRow>,
    pub due_counts: DueCounts,
    pub low_stock_tires: Vec<StockTireLine>,
    pub low_stock_oil: Vec<StockOilLine>,
    pub sync_pending: i64,
    pub sync_dead: i64,
}

pub fn home_summary(pool: &DbPool) -> AppResult<HomeSummary> {
    let open_wos = wo_list(pool, Some("open"), None)?;
    let due = due_board(pool, None)?;
    let due_counts = DueCounts {
        overdue: due.iter().filter(|d| d.status == "overdue").count() as i64,
        never_done: due.iter().filter(|d| d.status == "never_done").count() as i64,
        due_soon: due.iter().filter(|d| d.status == "due_soon").count() as i64,
    };
    let attention: Vec<DueRow> = due
        .iter()
        .filter(|d| d.status == "overdue" || d.status == "never_done" || d.status == "due_soon")
        .take(8)
        .cloned()
        .collect();
    let stock = stock_view(pool)?;
    let low_stock_tires: Vec<StockTireLine> =
        stock.tires.into_iter().filter(|t| t.low_stock).collect();
    let low_stock_oil: Vec<StockOilLine> =
        stock.oil.into_iter().filter(|o| o.low_stock).collect();

    let conn = pool.get()?;
    let counts = outbox::counts(&conn)?;

    Ok(HomeSummary {
        open_wos,
        attention,
        due_counts,
        low_stock_tires,
        low_stock_oil,
        sync_pending: counts.pending,
        sync_dead: counts.dead,
    })
}

