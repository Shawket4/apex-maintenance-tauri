//! Omnisearch across plates, DOT codes, and open work.


use serde::Serialize;

use crate::db::DbPool;
use crate::AppResult;

use super::*;

// ═════════════════════════════ omnisearch ════════════════════════════════════

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct SearchResults {
    pub trucks: Vec<TruckRow>,
    pub tires: Vec<TireRow>,
    pub work_orders: Vec<WoListRow>,
}

pub fn search_all(pool: &DbPool, q: &str) -> AppResult<SearchResults> {
    let nq = fold_search(q);
    if nq.is_empty() {
        return Ok(SearchResults { trucks: vec![], tires: vec![], work_orders: vec![] });
    }
    let mut trucks = truck_list(pool, Some(q))?;
    trucks.truncate(8);
    let mut tires = tires_list(pool, None, Some(q))?;
    tires.truncate(8);
    let mut work_orders: Vec<WoListRow> = wo_list(pool, None, None)?
        .into_iter()
        .filter(|w| {
            fold_search(&w.plate).contains(&nq)
                || w.title.as_deref().map(|t| fold_search(t).contains(&nq)).unwrap_or(false)
        })
        .collect();
    work_orders.truncate(8);
    Ok(SearchResults { trucks, tires, work_orders })
}
