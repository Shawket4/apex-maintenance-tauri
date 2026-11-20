//! Catalog options for the pickers: tire products, oil products, standard
//! jobs.
//!
//! The server owns the catalog and learns new products from whatever text
//! arrives. Offline, a product typed a minute ago is not in the mirror yet —
//! so the options here are the mirror PLUS anything already used on this
//! device that the mirror does not know (matched the way the server matches:
//! `norm`). A product typed once is offered the next time, connected or not.

use std::collections::HashSet;

use serde::Serialize;

use crate::db::DbPool;
use crate::AppResult;

use super::*;

/// Comparison key — MUST match maint-rust `maint_norm` (migration 0024):
/// case, spacing, punctuation, Arabic letter variants and digit scripts do
/// not make a different product.
pub fn norm(s: &str) -> String {
    normalize_digits(s)
        .chars()
        .filter_map(|c| match c {
            'أ' | 'إ' | 'آ' | 'ٱ' => Some('ا'),
            'ة' => Some('ه'),
            'ى' => Some('ي'),
            'ؤ' => Some('و'),
            'ئ' => Some('ي'),
            c if c.is_ascii_alphanumeric() => Some(c.to_ascii_lowercase()),
            c if ('\u{0621}'..='\u{064A}').contains(&c) => Some(c),
            _ => None,
        })
        .collect()
}

pub fn tire_key(brand: &str, model: &str, size: &str) -> String {
    format!("{}|{}|{}", norm(brand), norm(model), norm(size))
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct TireProductOption {
    /// None = used on this device, not confirmed by the server yet.
    pub id: Option<String>,
    pub brand: String,
    pub model: String,
    pub size: String,
    /// New tires in stock (server count minus fittings still queued here).
    pub on_hand: Option<i64>,
    pub tires: i64,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct OilProductOption {
    pub id: Option<String>,
    pub name: String,
    pub on_hand: Option<f64>,
    pub uses: i64,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct JobOption {
    pub id: String,
    pub name_ar: String,
    pub name_en: Option<String>,
    pub category_id: Option<String>,
    pub uses: i64,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CatalogView {
    pub tire_products: Vec<TireProductOption>,
    pub oil_products: Vec<OilProductOption>,
    pub standard_jobs: Vec<JobOption>,
}

pub fn catalog(pool: &DbPool) -> AppResult<CatalogView> {
    let stock = stock_view(pool)?;
    let conn = pool.get()?;

    let mut tire_products: Vec<TireProductOption> = {
        let mut stmt = conn.prepare("SELECT id, brand, model, size, tires FROM tire_products ORDER BY brand, model, size")?;
        let v = stmt
            .query_map([], |r| {
                Ok(TireProductOption { id: r.get(0)?, brand: r.get(1)?, model: r.get(2)?, size: r.get(3)?, on_hand: None, tires: r.get(4)? })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        v
    };
    let mut seen: HashSet<String> = tire_products.iter().map(|p| tire_key(&p.brand, &p.model, &p.size)).collect();
    // Stock lines and local tires the mirror does not list yet.
    let mut extra: Vec<(String, String, String)> =
        stock.tires.iter().map(|l| (l.brand.clone(), l.model.clone().unwrap_or_default(), l.size.clone().unwrap_or_default())).collect();
    {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT brand, COALESCE(model,''), COALESCE(size,'') FROM tires WHERE deleted_at IS NULL AND brand IS NOT NULL",
        )?;
        extra.extend(stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<Vec<_>, _>>()?);
    }
    for (brand, model, size) in extra {
        if !norm(&brand).is_empty() && seen.insert(tire_key(&brand, &model, &size)) {
            tire_products.push(TireProductOption { id: None, brand, model, size, on_hand: None, tires: 0 });
        }
    }
    for p in &mut tire_products {
        let k = tire_key(&p.brand, &p.model, &p.size);
        p.on_hand = stock
            .tires
            .iter()
            .find(|l| tire_key(&l.brand, l.model.as_deref().unwrap_or(""), l.size.as_deref().unwrap_or("")) == k)
            .map(|l| l.projected_qty);
    }

    let mut oil_products: Vec<OilProductOption> = {
        let mut stmt = conn.prepare("SELECT id, name, uses FROM oil_products ORDER BY name")?;
        let v = stmt
            .query_map([], |r| Ok(OilProductOption { id: r.get(0)?, name: r.get(1)?, on_hand: None, uses: r.get(2)? }))?
            .collect::<Result<Vec<_>, _>>()?;
        v
    };
    let mut seen: HashSet<String> = oil_products.iter().map(|p| norm(&p.name)).collect();
    let mut extra: Vec<String> = stock.oil.iter().map(|l| l.oil_type.clone()).collect();
    {
        let mut stmt = conn.prepare("SELECT DISTINCT oil_type FROM oil_changes WHERE deleted_at IS NULL AND oil_type IS NOT NULL")?;
        extra.extend(stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?);
    }
    for name in extra {
        if !norm(&name).is_empty() && seen.insert(norm(&name)) {
            oil_products.push(OilProductOption { id: None, name, on_hand: None, uses: 0 });
        }
    }
    for p in &mut oil_products {
        let k = norm(&p.name);
        p.on_hand = stock.oil.iter().find(|l| norm(&l.oil_type) == k).map(|l| l.projected_liters);
    }

    let standard_jobs = {
        let mut stmt = conn.prepare("SELECT id, name_ar, name_en, category_id, uses FROM standard_jobs ORDER BY uses DESC, name_ar")?;
        let v = stmt
            .query_map([], |r| {
                Ok(JobOption { id: r.get(0)?, name_ar: r.get(1)?, name_en: r.get(2)?, category_id: r.get(3)?, uses: r.get(4)? })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        v
    };

    Ok(CatalogView { tire_products, oil_products, standard_jobs })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn norm_matches_the_server_rule() {
        // The same pairs as maint-rust tests/catalog_live.rs::norm_ignores_what_people_vary.
        assert_eq!(norm("315/80R22.5"), norm(" 315 / 80 r 22.5 "));
        assert_eq!(norm("أحمد"), norm("احمد"));
        assert_eq!(norm("٣١٥"), norm("315"));
        assert_eq!(norm("Bridge-Stone"), norm("bridgestone"));
        assert_eq!(norm("  "), "");
        assert_ne!(tire_key("A", "B", ""), tire_key("A", "", "B"), "fields do not bleed into each other");
    }
}
