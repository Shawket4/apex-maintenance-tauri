//! Reference mirrors: categories, classes, plans.


use serde::Serialize;

use crate::db::DbPool;
use crate::AppResult;


// ═════════════════════════════ reference ═════════════════════════════════════

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CategoryRow {
    pub id: String,
    pub name_ar: String,
    pub name_en: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub sort_order: i64,
}

pub fn categories_list(pool: &DbPool) -> AppResult<Vec<CategoryRow>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, name_ar, name_en, icon, color, sort_order FROM maintenance_categories ORDER BY sort_order",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(CategoryRow {
                id: r.get(0)?,
                name_ar: r.get(1)?,
                name_en: r.get(2)?,
                icon: r.get(3)?,
                color: r.get(4)?,
                sort_order: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct ClassRow {
    pub id: String,
    pub name_ar: String,
    pub name_en: String,
    pub sort_order: i64,
}

pub fn classes_list(pool: &DbPool) -> AppResult<Vec<ClassRow>> {
    let conn = pool.get()?;
    let mut stmt =
        conn.prepare("SELECT id, name_ar, name_en, sort_order FROM vehicle_classes ORDER BY sort_order")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ClassRow {
                id: r.get(0)?,
                name_ar: r.get(1)?,
                name_en: r.get(2)?,
                sort_order: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PlanRow {
    pub id: String,
    pub class_id: String,
    pub category_id: String,
    pub trigger_type: String,
    pub interval_km: Option<i64>,
    pub interval_days: Option<i64>,
    pub lead_warn_km: Option<i64>,
    pub lead_warn_days: Option<i64>,
    pub is_active: bool,
}

pub fn plans_list(pool: &DbPool) -> AppResult<Vec<PlanRow>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, class_id, category_id, trigger_type, interval_km, interval_days,
                lead_warn_km, lead_warn_days, is_active
           FROM service_plans WHERE deleted_at IS NULL ORDER BY class_id, category_id",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(PlanRow {
                id: r.get(0)?,
                class_id: r.get(1)?,
                category_id: r.get(2)?,
                trigger_type: r.get(3)?,
                interval_km: r.get(4)?,
                interval_days: r.get(5)?,
                lead_warn_km: r.get(6)?,
                lead_warn_days: r.get(7)?,
                is_active: r.get::<_, i64>(8)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

