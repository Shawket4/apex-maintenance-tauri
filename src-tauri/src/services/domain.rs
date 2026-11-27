//! Owned-domain WRITES against the local database.
//!
//! Every write is one IMMEDIATE SQLite transaction that (a) checks the rules,
//! (b) changes the local tables and (c) queues the same change in the outbox.
//! Nothing here talks to the network; the commands layer kicks the engine.
//!
//! * One user action = one transaction = one outbox GROUP. The server applies
//!   a group all-or-nothing, so a refused mount never leaves a tire behind.
//! * An insert queues the row; an update queues ONLY the columns it changed.
//! * `tires.status` is the server's projection of mounts, dismounts and
//!   status events. The same rule is applied here for immediate feedback and
//!   is never queued; the next pull confirms it.
//! * Rules are refused with a stable code (`AppError::Rule`) that the UI
//!   translates — no English sentence reaches the user.

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::DbPool;
use crate::services::outbox::{self, Enqueued, NewOp};
use crate::services::schema;
use crate::{AppError, AppResult};

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// The 34–36 L band. The server recomputes the flag; this copy is for
/// immediate feedback. MUST match maint-rust `rules::OIL_FLAG_*`.
pub const OIL_FLAG_MIN: f64 = 34.0;
pub const OIL_FLAG_MAX: f64 = 36.0;
pub const MAX_ODOMETER: i64 = 9_999_999;
pub const MAX_LITERS: f64 = 1000.0;

pub fn oil_flagged(liters: f64) -> bool {
    !(OIL_FLAG_MIN..=OIL_FLAG_MAX).contains(&liters)
}

/// Dismount reason → tire status. MUST match maint-rust `rules::dismount_status`.
pub fn dismount_status(reason: &str) -> &'static str {
    match reason {
        "worn" | "damaged" => "scrapped",
        "retread" => "retreading",
        "puncture" => "in_repair",
        _ => "in_stock_used",
    }
}

const MOUNT_REASONS: &[&str] = &["new", "rotation", "replacement", "repair_return", "onboard"];
const DISMOUNT_REASONS: &[&str] = &["worn", "damaged", "rotation", "puncture", "retread", "other"];

fn rule(code: &'static str, message: &str) -> AppError {
    AppError::rule(code, message)
}

fn check_odometer(km: Option<i64>) -> AppResult<()> {
    match km {
        Some(k) if !(0..=MAX_ODOMETER).contains(&k) => Err(rule("odometer_range", "odometer out of range")),
        _ => Ok(()),
    }
}

fn clean(s: Option<&str>) -> Option<String> {
    s.map(str::trim).filter(|t| !t.is_empty()).map(|t| t.chars().take(500).collect())
}

// ── the write path ───────────────────────────────────────────────────────────

/// One action: its transaction, who did it, and the group its ops share.
struct Action<'a> {
    tx: &'a Connection,
    user_id: i64,
    group: String,
}

fn write<T>(pool: &DbPool, user_id: i64, f: impl FnOnce(&Action<'_>) -> AppResult<T>) -> AppResult<T> {
    let mut conn = pool.get()?;
    // IMMEDIATE: take the write lock before reading. A deferred transaction
    // that reads first and writes later fails with "database is locked" when
    // a pull or refresh writes in between; busy_timeout does not cover that.
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let action = Action { tx: &tx, user_id, group: Uuid::new_v4().to_string() };
    let out = f(&action)?;
    tx.commit()?;
    Ok(out)
}

impl Action<'_> {
    /// The row as stored, restricted to `only` (or every client column).
    fn snapshot(&self, entity: &str, id: &str, only: Option<&[&str]>) -> AppResult<(Value, i64)> {
        let meta = schema::meta(entity).ok_or_else(|| AppError::Internal(format!("unknown entity {entity}")))?;
        let sql = format!("SELECT {} FROM {entity} WHERE {} = ?1", meta.columns.join(", "), meta.pk);
        let mut stmt = self.tx.prepare(&sql)?;
        let row = stmt
            .query_row(params![id], |r| {
                let mut obj = serde_json::Map::new();
                let mut sv = 1i64;
                for (i, c) in meta.columns.iter().enumerate() {
                    let val = match r.get_ref(i)? {
                        rusqlite::types::ValueRef::Null => Value::Null,
                        rusqlite::types::ValueRef::Integer(n) => {
                            if *c == "sync_version" {
                                sv = n;
                            }
                            if meta.bool_cols.contains(c) {
                                Value::Bool(n != 0)
                            } else {
                                json!(n)
                            }
                        }
                        rusqlite::types::ValueRef::Real(f) => json!(f),
                        rusqlite::types::ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).to_string()),
                        rusqlite::types::ValueRef::Blob(_) => Value::Null,
                    };
                    let wanted = match only {
                        Some(cols) => cols.contains(c) || *c == meta.pk,
                        None => !schema::SERVER_OWNED.contains(c),
                    };
                    if wanted {
                        obj.insert((*c).to_string(), val);
                    }
                }
                Ok((Value::Object(obj), sv))
            })
            .optional()?;
        row.ok_or_else(|| AppError::Internal(format!("{entity} {id} vanished mid-transaction")))
    }

    fn queue(&self, entity: &str, id: &str, op: &str, payload: &Value, base: i64) -> AppResult<Enqueued> {
        Ok(outbox::enqueue(
            self.tx,
            &NewOp {
                entity_type: entity,
                entity_id: id,
                op,
                payload,
                base_sync_version: base,
                user_id: self.user_id,
                group_id: Some(&self.group),
            },
        )?)
    }

    fn inserted(&self, entity: &str, id: &str) -> AppResult<()> {
        let (payload, _) = self.snapshot(entity, id, None)?;
        self.queue(entity, id, "insert", &payload, 0)?;
        Ok(())
    }

    fn updated(&self, entity: &str, id: &str, cols: &[&str]) -> AppResult<()> {
        let (payload, sv) = self.snapshot(entity, id, Some(cols))?;
        self.queue(entity, id, "update", &payload, sv)?;
        Ok(())
    }

    /// Soft-delete locally and queue the delete. If the server never saw the
    /// row (its insert had not been sent), the row is simply removed.
    fn deleted(&self, entity: &str, id: &str) -> AppResult<()> {
        let pk = schema::pk_for(entity);
        let sv: i64 = self
            .tx
            .query_row(&format!("SELECT COALESCE(sync_version, 1) FROM {entity} WHERE {pk} = ?1"), params![id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| rule("not_found", "record not found"))?;
        if self.queue(entity, id, "delete", &json!({}), sv)? == Enqueued::Cancelled {
            self.tx.execute(&format!("DELETE FROM {entity} WHERE {pk} = ?1"), params![id])?;
        } else {
            self.tx.execute(
                &format!("UPDATE {entity} SET deleted_at = ?2, updated_at = ?2, updated_by_user_id = ?3 WHERE {pk} = ?1"),
                params![id, now_iso(), self.user_id],
            )?;
        }
        Ok(())
    }
}

// ═════════════════════════════ work orders ═══════════════════════════════════

/// (status, vehicle_id) of a live work order.
fn work_order(tx: &Connection, id: &str) -> AppResult<(String, i64)> {
    tx.query_row(
        "SELECT status, vehicle_id FROM work_orders WHERE id = ?1 AND deleted_at IS NULL",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?
    .ok_or_else(|| rule("wo_not_found", "work order not found"))
}

fn open_work_order(tx: &Connection, id: &str) -> AppResult<i64> {
    let (status, vehicle_id) = work_order(tx, id)?;
    if status != "open" {
        return Err(rule("wo_closed", "the work order is closed"));
    }
    Ok(vehicle_id)
}

pub fn wo_open(pool: &DbPool, vehicle_id: i64, odometer_at_open: Option<i64>, user_id: i64) -> AppResult<String> {
    check_odometer(odometer_at_open)?;
    write(pool, user_id, |a| {
        let known: bool = a.tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM vehicles_cache WHERE id = ?1 AND source_deleted_at IS NULL)",
            params![vehicle_id],
            |r| r.get(0),
        )?;
        if !known {
            return Err(rule("vehicle_not_found", "vehicle not found"));
        }
        let id = Uuid::new_v4().to_string();
        let now = now_iso();
        a.tx.execute(
            "INSERT INTO work_orders
               (id, vehicle_id, status, title, odometer_at_open, opened_at,
                created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
             VALUES (?1,?2,'open',NULL,?3,?4,?4,?4,?5,?5,1)",
            params![id, vehicle_id, odometer_at_open, now, user_id],
        )?;
        a.inserted("work_orders", &id)?;
        Ok(id)
    })
}

pub fn wo_close(pool: &DbPool, id: &str, user_id: i64) -> AppResult<()> {
    write(pool, user_id, |a| {
        open_work_order(a.tx, id)?;
        let now = now_iso();
        a.tx.execute(
            "UPDATE work_orders SET status='closed', closed_at=?2, updated_at=?2, updated_by_user_id=?3 WHERE id=?1",
            params![id, now, user_id],
        )?;
        a.updated("work_orders", id, &["status", "closed_at"])
    })
}

pub fn wo_reopen(pool: &DbPool, id: &str, user_id: i64) -> AppResult<()> {
    write(pool, user_id, |a| {
        let (status, _) = work_order(a.tx, id)?;
        if status != "closed" {
            return Err(rule("wo_not_closed", "the work order is not closed"));
        }
        a.tx.execute(
            "UPDATE work_orders SET status='open', closed_at=NULL, updated_at=?2, updated_by_user_id=?3 WHERE id=?1",
            params![id, now_iso(), user_id],
        )?;
        a.updated("work_orders", id, &["status", "closed_at"])
    })
}

/// Correct the odometer of a work order. It is an odometer reading AND the km
/// baseline of every task done under it.
pub fn wo_set_odometer(pool: &DbPool, id: &str, odometer_at_open: Option<i64>, user_id: i64) -> AppResult<()> {
    check_odometer(odometer_at_open)?;
    write(pool, user_id, |a| {
        work_order(a.tx, id)?;
        a.tx.execute(
            "UPDATE work_orders SET odometer_at_open=?2, updated_at=?3, updated_by_user_id=?4 WHERE id=?1",
            params![id, odometer_at_open, now_iso(), user_id],
        )?;
        a.updated("work_orders", id, &["odometer_at_open"])
    })
}

/// Title and notes — what was wrong, who brought it, what is still waiting.
pub fn wo_set_notes(pool: &DbPool, id: &str, title: Option<&str>, notes: Option<&str>, user_id: i64) -> AppResult<()> {
    write(pool, user_id, |a| {
        work_order(a.tx, id)?;
        let notes: Option<String> = notes.map(str::trim).filter(|t| !t.is_empty()).map(|t| t.chars().take(2000).collect());
        a.tx.execute(
            "UPDATE work_orders SET title=?2, notes_ar=?3, updated_at=?4, updated_by_user_id=?5 WHERE id=?1",
            params![id, clean(title), notes, now_iso(), user_id],
        )?;
        a.updated("work_orders", id, &["title", "notes_ar"])
    })
}

/// Remove a work order opened by mistake (wrong truck, double click). Refused
/// once tire or oil work is recorded on it — that work changed stock and tire
/// state and has to be undone first. Its tasks go with it.
pub fn wo_delete(pool: &DbPool, id: &str, user_id: i64) -> AppResult<()> {
    write(pool, user_id, |a| {
        work_order(a.tx, id)?;
        let busy: bool = a.tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM oil_changes WHERE work_order_id = ?1 AND deleted_at IS NULL)
                 OR EXISTS (SELECT 1 FROM tire_assignments
                             WHERE (work_order_id = ?1 OR dismount_work_order_id = ?1) AND deleted_at IS NULL)",
            params![id],
            |r| r.get(0),
        )?;
        if busy {
            return Err(rule("wo_not_empty", "the work order has tire or oil work"));
        }
        // The server tombstones the tasks itself; mirror that locally. Tasks
        // it has never seen are queued inserts — cancel those.
        let tasks: Vec<String> = {
            let mut stmt = a.tx.prepare("SELECT id FROM work_order_tasks WHERE work_order_id = ?1 AND deleted_at IS NULL")?;
            let v = stmt.query_map(params![id], |r| r.get(0))?.collect::<Result<Vec<_>, _>>()?;
            v
        };
        for t in tasks {
            a.deleted("work_order_tasks", &t)?;
        }
        a.deleted("work_orders", id)
    })
}

/// Seed a historical "last done" without faking today's date: a CLOSED work
/// order stamped with the real date + odometer and one done task.
pub fn record_baseline(
    pool: &DbPool,
    vehicle_id: i64,
    category_id: &str,
    performed_at: &str,
    odometer: Option<i64>,
    user_id: i64,
) -> AppResult<String> {
    check_odometer(odometer)?;
    // A date from a date input; noon UTC keeps it on the same calendar day in Cairo.
    let ts = format!("{performed_at}T12:00:00.000Z");
    let parsed = chrono::DateTime::parse_from_rfc3339(&ts).map_err(|_| rule("bad_date", "invalid date"))?;
    if parsed.with_timezone(&chrono::Utc) > chrono::Utc::now() + chrono::Duration::days(1) {
        return Err(rule("date_in_future", "the date is in the future"));
    }
    write(pool, user_id, |a| {
        let wo_id = Uuid::new_v4().to_string();
        let task_id = Uuid::new_v4().to_string();
        let now = now_iso();
        a.tx.execute(
            "INSERT INTO work_orders
               (id, vehicle_id, status, title, odometer_at_open, opened_at, closed_at,
                created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
             VALUES (?1,?2,'closed',NULL,?3,?4,?4,?5,?5,?6,?6,1)",
            params![wo_id, vehicle_id, odometer, ts, now, user_id],
        )?;
        a.inserted("work_orders", &wo_id)?;
        a.tx.execute(
            "INSERT INTO work_order_tasks
               (id, work_order_id, kind, category_id, is_done, done_at, sort_order,
                created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
             VALUES (?1,?2,'free',?3,1,?4,1,?5,?5,?6,?6,1)",
            params![task_id, wo_id, category_id, ts, now, user_id],
        )?;
        a.inserted("work_order_tasks", &task_id)?;
        Ok(wo_id)
    })
}

/// Namespace of typed-in maintenance types: a type's id is "c-" + the UUID v5
/// of its name's key in it, so two devices typing the same name offline meet
/// on one type.
pub const CATEGORY_NAMESPACE: Uuid = Uuid::from_u128(0x7c3e1f52_9a4b_4d2e_8f61_2b9d0c5a7e13);

/// The comparison key of a name, as the server's `maint_norm`: case, spacing,
/// punctuation, Arabic letter variants and digit scripts do not matter.
pub fn norm_key(s: &str) -> String {
    s.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'أ' | 'إ' | 'آ' | 'ٱ' => 'ا',
            'ة' => 'ه',
            'ى' | 'ئ' => 'ي',
            'ؤ' => 'و',
            '٠'..='٩' => char::from_digit(c as u32 - '٠' as u32, 10).unwrap(),
            '۰'..='۹' => char::from_digit(c as u32 - '۰' as u32, 10).unwrap(),
            c => c,
        })
        .filter(|c| c.is_ascii_digit() || c.is_ascii_lowercase() || ('\u{0621}'..='\u{064A}').contains(c))
        .collect()
}

/// The task's maintenance type: one from the list, or a name typed in. A typed
/// name a type already has is that type; a new one gets its id here and is
/// listed locally until the server, told its name, creates it. Returns the
/// type's id and, for a new type, the name the task carries.
fn resolve_category(tx: &Connection, category_id: Option<String>, typed: Option<String>) -> AppResult<(Option<String>, Option<String>)> {
    let Some(name) = typed else { return Ok((category_id, None)) };
    let key = norm_key(&name);
    if key.is_empty() {
        return Ok((category_id, None));
    }
    let mut stmt = tx.prepare("SELECT id, name_ar FROM maintenance_categories")?;
    let known = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    if let Some((id, _)) = known.iter().find(|(_, n)| norm_key(n) == key) {
        return Ok((Some(id.clone()), None));
    }
    let id = format!("c-{}", Uuid::new_v5(&CATEGORY_NAMESPACE, key.as_bytes()));
    tx.execute(
        "INSERT OR IGNORE INTO maintenance_categories (id, name_ar, name_en, sort_order)
         VALUES (?1, ?2, ?2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM maintenance_categories))",
        params![id, name],
    )?;
    Ok((Some(id), Some(name)))
}

/// A job typed under a type joins that type's jobs here at once (the server
/// does the same when the task arrives). The type's own name is not a job.
fn learn_job(tx: &Connection, category: Option<&str>, description: Option<&str>) -> AppResult<()> {
    let (Some(cat), Some(desc)) = (category, description) else { return Ok(()) };
    let key = norm_key(desc);
    let cat_name: Option<String> =
        tx.query_row("SELECT name_ar FROM maintenance_categories WHERE id = ?1", params![cat], |r| r.get(0)).optional()?;
    if key.is_empty() || cat_name.map(|n| norm_key(&n) == key).unwrap_or(false) {
        return Ok(());
    }
    let mut stmt = tx.prepare("SELECT name_ar FROM standard_jobs")?;
    let exists = stmt.query_map([], |r| r.get::<_, String>(0))?.filter_map(Result::ok).any(|n| norm_key(&n) == key);
    if !exists {
        tx.execute(
            "INSERT INTO standard_jobs (id, name_ar, category_id, uses) VALUES (?1, ?2, ?3, 0)",
            params![format!("local-{}", Uuid::new_v4()), desc, cat],
        )?;
    }
    Ok(())
}

pub fn wo_add_task(
    pool: &DbPool,
    work_order_id: &str,
    category_id: Option<&str>,
    new_category_name: Option<&str>,
    description_ar: &str,
    user_id: i64,
) -> AppResult<String> {
    let description = clean(Some(description_ar));
    let typed = clean(new_category_name);
    let category = clean(category_id);
    if description.is_none() && category.is_none() && typed.is_none() {
        return Err(rule("task_empty", "a task needs a description or a category"));
    }
    write(pool, user_id, |a| {
        open_work_order(a.tx, work_order_id)?;
        let (category, category_name) = resolve_category(a.tx, category.clone(), typed.clone())?;
        let description = description.clone().or_else(|| category_name.clone());
        learn_job(a.tx, category.as_deref(), description.as_deref())?;
        let id = Uuid::new_v4().to_string();
        let now = now_iso();
        // Adding a task is planning: not done. Ticking it says the work happened.
        a.tx.execute(
            "INSERT INTO work_order_tasks
               (id, work_order_id, kind, category_id, category_name_ar, description_ar, is_done, done_at, sort_order,
                created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
             VALUES (?1,?2,'free',?3,?7,?4,0,NULL,
                     (SELECT COALESCE(MAX(sort_order),0)+1 FROM work_order_tasks WHERE work_order_id=?2),
                     ?5,?5,?6,?6,1)",
            params![id, work_order_id, category, description, now, user_id, category_name],
        )?;
        a.inserted("work_order_tasks", &id)?;
        Ok(id)
    })
}

fn live_task(tx: &Connection, task_id: &str) -> AppResult<String> {
    tx.query_row(
        "SELECT work_order_id FROM work_order_tasks WHERE id = ?1 AND deleted_at IS NULL",
        params![task_id],
        |r| r.get(0),
    )
    .optional()?
    .ok_or_else(|| rule("task_not_found", "task not found"))
}

/// Tick or untick a task. Ticking is what restarts the maintenance clock.
pub fn wo_task_set_done(pool: &DbPool, task_id: &str, done: bool, user_id: i64) -> AppResult<()> {
    write(pool, user_id, |a| {
        live_task(a.tx, task_id)?;
        let now = now_iso();
        a.tx.execute(
            "UPDATE work_order_tasks SET is_done=?2, done_at=?3, updated_at=?4, updated_by_user_id=?5 WHERE id=?1",
            params![task_id, done as i64, if done { Some(now.clone()) } else { None }, now, user_id],
        )?;
        a.updated("work_order_tasks", task_id, &["is_done", "done_at"])
    })
}

pub fn wo_task_update(
    pool: &DbPool,
    task_id: &str,
    category_id: Option<&str>,
    new_category_name: Option<&str>,
    description_ar: &str,
    user_id: i64,
) -> AppResult<()> {
    let description = clean(Some(description_ar));
    let typed = clean(new_category_name);
    let category = clean(category_id);
    if description.is_none() && category.is_none() && typed.is_none() {
        return Err(rule("task_empty", "a task needs a description or a category"));
    }
    write(pool, user_id, |a| {
        live_task(a.tx, task_id)?;
        let (category, category_name) = resolve_category(a.tx, category.clone(), typed.clone())?;
        let description = description.clone().or_else(|| category_name.clone());
        learn_job(a.tx, category.as_deref(), description.as_deref())?;
        a.tx.execute(
            "UPDATE work_order_tasks SET category_id=?2, category_name_ar=?6, description_ar=?3, updated_at=?4, updated_by_user_id=?5 WHERE id=?1",
            params![task_id, category, description, now_iso(), user_id, category_name],
        )?;
        a.updated("work_order_tasks", task_id, &["category_id", "category_name_ar", "description_ar"])
    })
}

pub fn wo_delete_task(pool: &DbPool, task_id: &str, user_id: i64) -> AppResult<()> {
    write(pool, user_id, |a| {
        live_task(a.tx, task_id)?;
        a.deleted("work_order_tasks", task_id)
    })
}

// ═════════════════════════════ oil ═══════════════════════════════════════════

fn check_oil(oil_type: &str, liters: f64, odometer: Option<i64>) -> AppResult<String> {
    let oil_type = oil_type.trim();
    if oil_type.is_empty() {
        return Err(rule("oil_type_required", "oil type is required"));
    }
    if !liters.is_finite() || liters <= 0.0 || liters > MAX_LITERS {
        return Err(rule("liters_range", "liters out of range"));
    }
    check_odometer(odometer)?;
    Ok(oil_type.to_string())
}

fn round2(liters: f64) -> f64 {
    (liters * 100.0).round() / 100.0
}

/// Oil change: the oil row and a done `oil` task (the due clock reads tasks),
/// as one action. Stock is debited by the server when the row arrives.
pub fn oil_add(
    pool: &DbPool,
    work_order_id: &str,
    oil_type: &str,
    liters: f64,
    odometer: Option<i64>,
    user_id: i64,
) -> AppResult<(String, bool)> {
    let oil_type = check_oil(oil_type, liters, odometer)?;
    let liters = round2(liters);
    write(pool, user_id, |a| {
        let vehicle_id = open_work_order(a.tx, work_order_id)?;
        let flagged = oil_flagged(liters);
        let oil_id = Uuid::new_v4().to_string();
        let task_id = Uuid::new_v4().to_string();
        let now = now_iso();
        a.tx.execute(
            "INSERT INTO oil_changes
               (id, work_order_id, vehicle_id, oil_type, liters, odometer, flagged, performed_at,
                created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8,?8,?9,?9,1)",
            params![oil_id, work_order_id, vehicle_id, oil_type, liters, odometer, flagged as i64, now, user_id],
        )?;
        a.inserted("oil_changes", &oil_id)?;
        a.tx.execute(
            "INSERT INTO work_order_tasks
               (id, work_order_id, kind, category_id, is_done, done_at, sort_order,
                created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
             VALUES (?1,?2,'oil','oil_change',1,?3,
                     (SELECT COALESCE(MAX(sort_order),0)+1 FROM work_order_tasks WHERE work_order_id=?2),
                     ?3,?3,?4,?4,1)",
            params![task_id, work_order_id, now, user_id],
        )?;
        a.inserted("work_order_tasks", &task_id)?;
        // "Oil change" planned on this work order (added from the due list)
        // is the same job: tick it rather than leave it looking undone.
        let planned: Vec<String> = {
            let mut stmt = a.tx.prepare(
                "SELECT id FROM work_order_tasks
                  WHERE work_order_id = ?1 AND kind = 'free' AND category_id = 'oil_change'
                    AND is_done = 0 AND deleted_at IS NULL",
            )?;
            let v = stmt.query_map(params![work_order_id], |r| r.get(0))?.collect::<Result<Vec<_>, _>>()?;
            v
        };
        for t in planned {
            a.tx.execute(
                "UPDATE work_order_tasks SET is_done=1, done_at=?2, updated_at=?2, updated_by_user_id=?3 WHERE id=?1",
                params![t, now, user_id],
            )?;
            a.updated("work_order_tasks", &t, &["is_done", "done_at"])?;
        }
        Ok((oil_id, flagged))
    })
}

fn live_oil(tx: &Connection, id: &str) -> AppResult<String> {
    tx.query_row("SELECT work_order_id FROM oil_changes WHERE id = ?1 AND deleted_at IS NULL", params![id], |r| {
        r.get::<_, Option<String>>(0)
    })
    .optional()?
    .map(|w| w.unwrap_or_default())
    .ok_or_else(|| rule("oil_not_found", "oil change not found"))
}

/// Correct an oil change. The server moves the stock difference.
pub fn oil_update(pool: &DbPool, id: &str, oil_type: &str, liters: f64, odometer: Option<i64>, user_id: i64) -> AppResult<bool> {
    let oil_type = check_oil(oil_type, liters, odometer)?;
    let liters = round2(liters);
    write(pool, user_id, |a| {
        live_oil(a.tx, id)?;
        let flagged = oil_flagged(liters);
        a.tx.execute(
            "UPDATE oil_changes SET oil_type=?2, liters=?3, odometer=?4, flagged=?5, updated_at=?6, updated_by_user_id=?7 WHERE id=?1",
            params![id, oil_type, liters, odometer, flagged as i64, now_iso(), user_id],
        )?;
        a.updated("oil_changes", id, &["oil_type", "liters", "odometer"])?;
        Ok(flagged)
    })
}

/// Remove an oil change entered by mistake. The server gives the liters back.
/// The work order's oil task goes too when no oil change is left on it.
pub fn oil_delete(pool: &DbPool, id: &str, user_id: i64) -> AppResult<()> {
    write(pool, user_id, |a| {
        let wo = live_oil(a.tx, id)?;
        a.deleted("oil_changes", id)?;
        let left: i64 = a.tx.query_row(
            "SELECT COUNT(*) FROM oil_changes WHERE work_order_id = ?1 AND deleted_at IS NULL",
            params![wo],
            |r| r.get(0),
        )?;
        if left == 0 {
            let tasks: Vec<String> = {
                let mut stmt = a.tx.prepare(
                    "SELECT id FROM work_order_tasks WHERE work_order_id = ?1 AND kind = 'oil' AND deleted_at IS NULL",
                )?;
                let v = stmt.query_map(params![wo], |r| r.get(0))?.collect::<Result<Vec<_>, _>>()?;
                v
            };
            for t in tasks {
                a.deleted("work_order_tasks", &t)?;
            }
        }
        Ok(())
    })
}

// ═════════════════════════════ odometer / class ══════════════════════════════

pub fn override_set(pool: &DbPool, vehicle_id: i64, odometer: i64, notes: Option<&str>, user_id: i64) -> AppResult<()> {
    check_odometer(Some(odometer))?;
    write(pool, user_id, |a| {
        let now = now_iso();
        let existed: bool = a.tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM vehicle_odometer_overrides WHERE vehicle_id = ?1)",
            params![vehicle_id],
            |r| r.get(0),
        )?;
        // The Falcon reading being corrected (the larger of fuel and mileage).
        // The arbitration ignores exactly that value until Falcon reports a
        // different one.
        let superseded: Option<i64> = a
            .tx
            .query_row(
                "SELECT NULLIF(MAX(COALESCE(last_fuel_odometer, 0), COALESCE(mileage, 0)), 0)
                   FROM vehicles_cache WHERE id = ?1",
                params![vehicle_id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        a.tx.execute(
            "INSERT INTO vehicle_odometer_overrides
               (vehicle_id, odometer, set_at, notes, superseded_km, created_at, updated_at,
                created_by_user_id, updated_by_user_id, sync_version)
             VALUES (?1,?2,?3,?4,?5,?3,?3,?6,?6,1)
             ON CONFLICT(vehicle_id) DO UPDATE SET
               odometer=excluded.odometer, set_at=excluded.set_at, notes=excluded.notes,
               superseded_km=excluded.superseded_km,
               updated_at=excluded.updated_at, updated_by_user_id=excluded.updated_by_user_id",
            params![vehicle_id, odometer, now, clean(notes), superseded, user_id],
        )?;
        let id = vehicle_id.to_string();
        if existed {
            a.updated("vehicle_odometer_overrides", &id, &["odometer", "set_at", "notes", "superseded_km"])
        } else {
            a.inserted("vehicle_odometer_overrides", &id)
        }
    })
}

/// Tag a vehicle with a maintenance class (drives the service plans).
pub fn class_assign(pool: &DbPool, vehicle_id: i64, class_id: &str, user_id: i64) -> AppResult<()> {
    write(pool, user_id, |a| {
        let known: bool =
            a.tx.query_row("SELECT EXISTS (SELECT 1 FROM vehicle_classes WHERE id = ?1)", params![class_id], |r| r.get(0))?;
        if !known {
            return Err(rule("class_not_found", "class not found"));
        }
        let now = now_iso();
        a.tx.execute(
            "INSERT INTO vehicle_class_assignments
               (vehicle_id, class_id, created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
             VALUES (?1,?2,?3,?3,?4,?4,1)
             ON CONFLICT(vehicle_id) DO UPDATE SET
               class_id=excluded.class_id, deleted_at=NULL,
               updated_at=excluded.updated_at, updated_by_user_id=excluded.updated_by_user_id",
            params![vehicle_id, class_id, now, user_id],
        )?;
        // The server upserts class assignments: insert covers tag and re-tag.
        a.inserted("vehicle_class_assignments", &vehicle_id.to_string())
    })
}

/// Remove a vehicle's class: it leaves the due board.
pub fn class_unassign(pool: &DbPool, vehicle_id: i64, user_id: i64) -> AppResult<()> {
    write(pool, user_id, |a| {
        let live: bool = a.tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM vehicle_class_assignments WHERE vehicle_id = ?1 AND deleted_at IS NULL)",
            params![vehicle_id],
            |r| r.get(0),
        )?;
        if !live {
            return Ok(());
        }
        a.deleted("vehicle_class_assignments", &vehicle_id.to_string())
    })
}

// ═════════════════════════════ tires ═════════════════════════════════════════

/// The local copy of the server's one rule for `tires.status`. Never queued.
fn rederive_tire(tx: &Connection, tire_id: &str) -> AppResult<()> {
    let open: bool = tx.query_row(
        "SELECT EXISTS (SELECT 1 FROM tire_assignments WHERE tire_id = ?1 AND dismounted_at IS NULL AND deleted_at IS NULL)",
        params![tire_id],
        |r| r.get(0),
    )?;
    let current: Option<String> =
        tx.query_row("SELECT status FROM tires WHERE id = ?1", params![tire_id], |r| r.get(0)).optional()?.flatten();
    let want = if open {
        "mounted".to_string()
    } else if current.as_deref() == Some("mounted") {
        let reason: Option<String> = tx
            .query_row(
                "SELECT dismount_reason FROM tire_assignments
                  WHERE tire_id = ?1 AND dismounted_at IS NOT NULL AND deleted_at IS NULL
                  ORDER BY julianday(dismounted_at) DESC LIMIT 1",
                params![tire_id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        dismount_status(reason.as_deref().unwrap_or("other")).to_string()
    } else {
        return Ok(());
    };
    tx.execute("UPDATE tires SET status = ?2 WHERE id = ?1 AND status IS NOT ?2", params![tire_id, want])?;
    Ok(())
}

/// A live road or spare position of this vehicle, currently empty.
fn free_position(tx: &Connection, position_id: &str, vehicle_id: i64) -> AppResult<()> {
    let owner: Option<i64> = tx
        .query_row(
            "SELECT l.vehicle_id FROM chassis_positions p JOIN chassis_layouts l ON l.id = p.layout_id
              WHERE p.id = ?1 AND p.deleted_at IS NULL AND l.deleted_at IS NULL",
            params![position_id],
            |r| r.get(0),
        )
        .optional()?;
    match owner {
        None => return Err(rule("position_not_found", "wheel position not found")),
        Some(v) if v != vehicle_id => return Err(rule("position_wrong_vehicle", "that position belongs to another vehicle")),
        _ => {}
    }
    let taken: bool = tx.query_row(
        "SELECT EXISTS (SELECT 1 FROM tire_assignments WHERE position_id = ?1 AND dismounted_at IS NULL AND deleted_at IS NULL)",
        params![position_id],
        |r| r.get(0),
    )?;
    if taken {
        return Err(rule("position_occupied", "that position already has a tire"));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_assignment(
    a: &Action<'_>,
    id: &str,
    tire_id: &str,
    position_id: &str,
    vehicle_id: i64,
    work_order_id: Option<&str>,
    odometer: Option<i64>,
    reason: &str,
) -> AppResult<()> {
    if !MOUNT_REASONS.contains(&reason) {
        return Err(rule("bad_reason", "invalid mount reason"));
    }
    check_odometer(odometer)?;
    free_position(a.tx, position_id, vehicle_id)?;
    let riding: bool = a.tx.query_row(
        "SELECT EXISTS (SELECT 1 FROM tire_assignments WHERE tire_id = ?1 AND dismounted_at IS NULL AND deleted_at IS NULL)",
        params![tire_id],
        |r| r.get(0),
    )?;
    if riding {
        return Err(rule("tire_already_mounted", "the tire is already mounted"));
    }
    let now = now_iso();
    a.tx.execute(
        "INSERT INTO tire_assignments
           (id, tire_id, position_id, vehicle_id, work_order_id, mounted_at, mounted_odometer,
            mount_reason, created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?6,?6,?9,?9,1)",
        params![id, tire_id, position_id, vehicle_id, work_order_id, now, odometer, reason, a.user_id],
    )?;
    a.inserted("tire_assignments", id)
}

struct TireSpec<'a> {
    brand: &'a str,
    model: Option<&'a str>,
    size: Option<&'a str>,
    dot_code: Option<&'a str>,
    origin: &'a str,
    status: &'a str,
    base_km: i64,
}

fn insert_tire(a: &Action<'_>, id: &str, t: &TireSpec<'_>) -> AppResult<()> {
    let brand = clean(Some(t.brand)).ok_or_else(|| rule("brand_required", "brand is required"))?;
    check_odometer(Some(t.base_km))?;
    let now = now_iso();
    a.tx.execute(
        "INSERT INTO tires
           (id, dot_code, brand, model, size, status, origin, total_km, retread_count,
            created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,?9,?9,?10,?10,1)",
        params![id, clean(t.dot_code), brand, clean(t.model), clean(t.size), t.status, t.origin, t.base_km, now, a.user_id],
    )?;
    a.inserted("tires", id)
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct MountFromStockInput {
    pub position_id: String,
    pub vehicle_id: i64,
    pub work_order_id: String,
    /// The stock line being consumed.
    pub brand: String,
    pub model: Option<String>,
    pub size: Option<String>,
    pub dot_code: Option<String>,
    pub odometer: Option<i64>,
}

/// Mount a NEW tire from stock: mints the tire and mounts it, as one action.
/// The server debits stock when the tire arrives.
pub fn mount_from_stock(pool: &DbPool, inp: &MountFromStockInput, user_id: i64) -> AppResult<(String, String)> {
    write(pool, user_id, |a| {
        if open_work_order(a.tx, &inp.work_order_id)? != inp.vehicle_id {
            return Err(rule("wo_wrong_vehicle", "the work order is for another vehicle"));
        }
        let tire_id = Uuid::new_v4().to_string();
        let assignment_id = Uuid::new_v4().to_string();
        insert_tire(
            a,
            &tire_id,
            &TireSpec {
                brand: &inp.brand,
                model: inp.model.as_deref(),
                size: inp.size.as_deref(),
                dot_code: inp.dot_code.as_deref(),
                origin: "shipment",
                status: "mounted",
                base_km: 0,
            },
        )?;
        insert_assignment(a, &assignment_id, &tire_id, &inp.position_id, inp.vehicle_id, Some(&inp.work_order_id), inp.odometer, "new")?;
        Ok((tire_id, assignment_id))
    })
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct MountUsedInput {
    pub tire_id: String,
    pub position_id: String,
    pub vehicle_id: i64,
    pub work_order_id: String,
    pub odometer: Option<i64>,
    /// rotation | replacement | repair_return
    pub reason: String,
}

/// Mount a tire from the used pool.
pub fn mount_used(pool: &DbPool, inp: &MountUsedInput, user_id: i64) -> AppResult<String> {
    write(pool, user_id, |a| {
        if open_work_order(a.tx, &inp.work_order_id)? != inp.vehicle_id {
            return Err(rule("wo_wrong_vehicle", "the work order is for another vehicle"));
        }
        let status: Option<String> = a
            .tx
            .query_row("SELECT status FROM tires WHERE id=?1 AND deleted_at IS NULL", params![inp.tire_id], |r| r.get(0))
            .optional()?;
        match status.as_deref() {
            Some("in_stock_used") => {}
            Some(_) => return Err(rule("tire_not_available", "the tire is not in the used pool")),
            None => return Err(rule("tire_not_found", "tire not found")),
        }
        let assignment_id = Uuid::new_v4().to_string();
        insert_assignment(a, &assignment_id, &inp.tire_id, &inp.position_id, inp.vehicle_id, Some(&inp.work_order_id), inp.odometer, &inp.reason)?;
        rederive_tire(a.tx, &inp.tire_id)?;
        Ok(assignment_id)
    })
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct DismountInput {
    pub assignment_id: String,
    pub odometer: Option<i64>,
    /// worn | damaged | rotation | puncture | retread | other
    pub reason: String,
    /// The work order this dismount happens under.
    pub work_order_id: Option<String>,
}

/// Dismount: close the assignment. Returns the tire id.
pub fn dismount(pool: &DbPool, inp: &DismountInput, user_id: i64) -> AppResult<String> {
    if !DISMOUNT_REASONS.contains(&inp.reason.as_str()) {
        return Err(rule("bad_reason", "invalid dismount reason"));
    }
    check_odometer(inp.odometer)?;
    write(pool, user_id, |a| {
        if let Some(wo) = &inp.work_order_id {
            open_work_order(a.tx, wo)?;
        }
        let row: Option<(String, Option<i64>)> = a
            .tx
            .query_row(
                "SELECT tire_id, mounted_odometer FROM tire_assignments
                  WHERE id=?1 AND dismounted_at IS NULL AND deleted_at IS NULL",
                params![inp.assignment_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((tire_id, mounted_km)) = row else {
            return Err(rule("assignment_not_found", "that tire is not mounted"));
        };
        if let (Some(m), Some(d)) = (mounted_km, inp.odometer) {
            if d < m {
                return Err(rule("odometer_backwards", "the dismount odometer is lower than the mount odometer"));
            }
        }
        let now = now_iso();
        a.tx.execute(
            "UPDATE tire_assignments SET dismounted_at=?2, dismounted_odometer=?3,
                dismount_reason=?4, dismount_work_order_id=?5, updated_at=?2, updated_by_user_id=?6
              WHERE id=?1",
            params![inp.assignment_id, now, inp.odometer, inp.reason, inp.work_order_id, user_id],
        )?;
        a.updated(
            "tire_assignments",
            &inp.assignment_id,
            &["dismounted_at", "dismounted_odometer", "dismount_reason", "dismount_work_order_id"],
        )?;
        a.tx.execute("UPDATE tires SET status = ?2 WHERE id = ?1", params![tire_id, dismount_status(&inp.reason)])?;
        Ok(tire_id)
    })
}

/// (tire_id, position_id, vehicle_id, is_open) of a live assignment.
fn assignment(tx: &Connection, id: &str) -> AppResult<(String, String, i64, bool)> {
    tx.query_row(
        "SELECT tire_id, position_id, vehicle_id, dismounted_at IS NULL FROM tire_assignments
          WHERE id = ?1 AND deleted_at IS NULL",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .optional()?
    .ok_or_else(|| rule("assignment_not_found", "mount record not found"))
}

/// Was this the tire's most recent dismount, with nothing done to it since?
fn is_latest_dismount(tx: &Connection, assignment_id: &str, tire_id: &str) -> AppResult<bool> {
    let later: bool = tx.query_row(
        "SELECT EXISTS (
            SELECT 1 FROM tire_assignments o, tire_assignments me
             WHERE me.id = ?1 AND o.tire_id = ?2 AND o.id <> me.id AND o.deleted_at IS NULL
               AND julianday(o.mounted_at) >= julianday(me.dismounted_at))
         OR EXISTS (
            SELECT 1 FROM tire_status_events e, tire_assignments me
             WHERE me.id = ?1 AND e.tire_id = ?2 AND e.deleted_at IS NULL
               AND julianday(e.occurred_at) >= julianday(me.dismounted_at))",
        params![assignment_id, tire_id],
        |r| r.get(0),
    )?;
    Ok(!later)
}

/// The tire came off for the wrong reason (a rotation recorded as "worn"
/// scraps it). Correct the reason; the tire's status follows.
pub fn dismount_set_reason(pool: &DbPool, assignment_id: &str, reason: &str, user_id: i64) -> AppResult<()> {
    if !DISMOUNT_REASONS.contains(&reason) {
        return Err(rule("bad_reason", "invalid dismount reason"));
    }
    write(pool, user_id, |a| {
        let (tire_id, _, _, open) = assignment(a.tx, assignment_id)?;
        if open {
            return Err(rule("still_mounted", "the tire is still mounted"));
        }
        let latest = is_latest_dismount(a.tx, assignment_id, &tire_id)?;
        a.tx.execute(
            "UPDATE tire_assignments SET dismount_reason=?2, updated_at=?3, updated_by_user_id=?4 WHERE id=?1",
            params![assignment_id, reason, now_iso(), user_id],
        )?;
        a.updated("tire_assignments", assignment_id, &["dismount_reason"])?;
        if latest {
            a.tx.execute("UPDATE tires SET status = ?2 WHERE id = ?1 AND status <> 'mounted'", params![tire_id, dismount_status(reason)])?;
        }
        Ok(())
    })
}

/// The wrong tire was taken off: put it back where it was.
pub fn dismount_undo(pool: &DbPool, assignment_id: &str, user_id: i64) -> AppResult<()> {
    write(pool, user_id, |a| {
        let (tire_id, position_id, vehicle_id, open) = assignment(a.tx, assignment_id)?;
        if open {
            return Err(rule("still_mounted", "the tire is still mounted"));
        }
        if !is_latest_dismount(a.tx, assignment_id, &tire_id)? {
            return Err(rule("tire_moved_on", "the tire has been used since"));
        }
        free_position(a.tx, &position_id, vehicle_id)?;
        a.tx.execute(
            "UPDATE tire_assignments SET dismounted_at=NULL, dismounted_odometer=NULL, dismount_reason=NULL,
                    dismount_work_order_id=NULL, updated_at=?2, updated_by_user_id=?3 WHERE id=?1",
            params![assignment_id, now_iso(), user_id],
        )?;
        a.updated(
            "tire_assignments",
            assignment_id,
            &["dismounted_at", "dismounted_odometer", "dismount_reason", "dismount_work_order_id"],
        )?;
        a.tx.execute("UPDATE tires SET status = 'mounted' WHERE id = ?1", params![tire_id])?;
        Ok(())
    })
}

/// The wrong tire was put on, or on the wrong wheel: remove the mount as if
/// it never happened. A tire that only existed because of this mount (new
/// from stock, or onboarded) is removed with it — the server gives a stock
/// tire back. Refused once the mount has been closed.
pub fn mount_undo(pool: &DbPool, assignment_id: &str, user_id: i64) -> AppResult<()> {
    write(pool, user_id, |a| {
        let (tire_id, _, _, open) = assignment(a.tx, assignment_id)?;
        if !open {
            return Err(rule("already_dismounted", "the tire has already been dismounted"));
        }
        // Read before deleting: an unsent mount is removed outright.
        let (reason, history): (Option<String>, i64) = a.tx.query_row(
            "SELECT (SELECT mount_reason FROM tire_assignments WHERE id = ?1),
                    (SELECT COUNT(*) FROM tire_assignments WHERE tire_id = ?2 AND id <> ?1 AND deleted_at IS NULL)
                  + (SELECT COUNT(*) FROM tire_status_events WHERE tire_id = ?2 AND deleted_at IS NULL)",
            params![assignment_id, tire_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        a.deleted("tire_assignments", assignment_id)?;
        let born_here = matches!(reason.as_deref(), Some("new") | Some("onboard")) && history == 0;
        if born_here {
            a.deleted("tires", &tire_id)?;
        } else {
            a.tx.execute("UPDATE tires SET status = 'in_stock_used' WHERE id = ?1", params![tire_id])?;
        }
        Ok(())
    })
}

/// Correct the odometer snapshots on a mount. Tire km is derived from these.
pub fn assignment_set_odometers(
    pool: &DbPool,
    assignment_id: &str,
    mounted_odometer: Option<i64>,
    dismounted_odometer: Option<i64>,
    user_id: i64,
) -> AppResult<()> {
    check_odometer(mounted_odometer)?;
    check_odometer(dismounted_odometer)?;
    write(pool, user_id, |a| {
        let (_, _, _, open) = assignment(a.tx, assignment_id)?;
        if dismounted_odometer.is_some() && open {
            return Err(rule("still_mounted", "the tire is still mounted"));
        }
        a.tx.execute(
            "UPDATE tire_assignments SET
                mounted_odometer    = COALESCE(?2, mounted_odometer),
                dismounted_odometer = COALESCE(?3, dismounted_odometer),
                updated_at = ?4, updated_by_user_id = ?5
              WHERE id = ?1",
            params![assignment_id, mounted_odometer, dismounted_odometer, now_iso(), user_id],
        )?;
        let (m, d): (Option<i64>, Option<i64>) = a.tx.query_row(
            "SELECT mounted_odometer, dismounted_odometer FROM tire_assignments WHERE id=?1",
            params![assignment_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if let (Some(m), Some(d)) = (m, d) {
            if d < m {
                return Err(rule("odometer_backwards", "the dismount odometer is lower than the mount odometer"));
            }
        }
        a.updated("tire_assignments", assignment_id, &["mounted_odometer", "dismounted_odometer"])
    })
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct OnboardPositionInput {
    pub position_id: String,
    pub vehicle_id: i64,
    pub brand: String,
    pub model: Option<String>,
    pub size: Option<String>,
    pub dot_code: Option<String>,
    /// Best-guess km already run (becomes the tire's starting km).
    pub estimated_km: Option<i64>,
    /// The truck's odometer now, so km run from here on can be counted.
    pub odometer: Option<i64>,
}

/// First-time registration of a tire that is already on the truck. No stock
/// effect (origin = legacy).
pub fn onboard_position(pool: &DbPool, inp: &OnboardPositionInput, user_id: i64) -> AppResult<(String, String)> {
    write(pool, user_id, |a| {
        let tire_id = Uuid::new_v4().to_string();
        let assignment_id = Uuid::new_v4().to_string();
        insert_tire(
            a,
            &tire_id,
            &TireSpec {
                brand: &inp.brand,
                model: inp.model.as_deref(),
                size: inp.size.as_deref(),
                dot_code: inp.dot_code.as_deref(),
                origin: "legacy",
                status: "mounted",
                base_km: inp.estimated_km.unwrap_or(0),
            },
        )?;
        insert_assignment(a, &assignment_id, &tire_id, &inp.position_id, inp.vehicle_id, None, inp.odometer, "onboard")?;
        Ok((tire_id, assignment_id))
    })
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct LegacyTireInput {
    pub brand: String,
    pub model: Option<String>,
    pub size: Option<String>,
    pub dot_code: Option<String>,
    pub estimated_km: Option<i64>,
}

/// Register used tires sitting in the yard as individual used stock.
pub fn intake_legacy(pool: &DbPool, tires: &[LegacyTireInput], user_id: i64) -> AppResult<Vec<String>> {
    if tires.is_empty() || tires.len() > 200 {
        return Err(rule("bad_count", "between 1 and 200 tires at a time"));
    }
    write(pool, user_id, |a| {
        let mut ids = Vec::with_capacity(tires.len());
        for t in tires {
            let id = Uuid::new_v4().to_string();
            insert_tire(
                a,
                &id,
                &TireSpec {
                    brand: &t.brand,
                    model: t.model.as_deref(),
                    size: t.size.as_deref(),
                    dot_code: t.dot_code.as_deref(),
                    origin: "legacy",
                    status: "in_stock_used",
                    base_km: t.estimated_km.unwrap_or(0),
                },
            )?;
            ids.push(id);
        }
        Ok(ids)
    })
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct TireEditInput {
    pub brand: String,
    pub model: Option<String>,
    pub size: Option<String>,
    pub dot_code: Option<String>,
    /// Km the tire had run before it was first registered here.
    pub base_km: i64,
    pub notes: Option<String>,
}

/// Correct what was typed about a tire (brand, size, DOT, starting km, notes).
pub fn tire_update(pool: &DbPool, tire_id: &str, inp: &TireEditInput, user_id: i64) -> AppResult<()> {
    let brand = clean(Some(&inp.brand)).ok_or_else(|| rule("brand_required", "brand is required"))?;
    check_odometer(Some(inp.base_km))?;
    write(pool, user_id, |a| {
        let n = a.tx.execute(
            "UPDATE tires SET brand=?2, model=?3, size=?4, dot_code=?5, total_km=?6, notes_ar=?7,
                    updated_at=?8, updated_by_user_id=?9
              WHERE id=?1 AND deleted_at IS NULL",
            params![
                tire_id,
                brand,
                clean(inp.model.as_deref()),
                clean(inp.size.as_deref()),
                clean(inp.dot_code.as_deref()),
                inp.base_km,
                clean(inp.notes.as_deref()),
                now_iso(),
                user_id
            ],
        )?;
        if n == 0 {
            return Err(rule("tire_not_found", "tire not found"));
        }
        a.updated("tires", tire_id, &["brand", "model", "size", "dot_code", "total_km", "notes_ar"])
    })
}

/// Remove a tire record created by mistake. A mounted tire has to come off first.
pub fn tire_delete(pool: &DbPool, tire_id: &str, user_id: i64) -> AppResult<()> {
    write(pool, user_id, |a| {
        let status: Option<String> = a
            .tx
            .query_row("SELECT status FROM tires WHERE id=?1 AND deleted_at IS NULL", params![tire_id], |r| r.get(0))
            .optional()?;
        match status.as_deref() {
            None => return Err(rule("tire_not_found", "tire not found")),
            Some("mounted") => return Err(rule("tire_mounted", "the tire is mounted")),
            _ => {}
        }
        a.deleted("tires", tire_id)
    })
}

/// Lifecycle step from the tire file (to repair, back from repair, to the
/// retreader, back to stock, scrap). Only the EVENT is queued; the server
/// derives the status from it, and the same step is applied here.
pub fn tire_set_status(
    pool: &DbPool,
    tire_id: &str,
    to_status: &str,
    event_type: &str,
    notes: Option<&str>,
    user_id: i64,
) -> AppResult<()> {
    if !["in_stock_used", "in_repair", "retreading", "scrapped"].contains(&to_status) {
        return Err(rule("bad_status", "invalid status"));
    }
    if !["scrap", "retread", "repair_out", "repair_in", "restock", "intake"].contains(&event_type) {
        return Err(rule("bad_status", "invalid event"));
    }
    write(pool, user_id, |a| {
        let from: Option<String> = a
            .tx
            .query_row("SELECT status FROM tires WHERE id=?1 AND deleted_at IS NULL", params![tire_id], |r| r.get(0))
            .optional()?;
        let Some(from) = from else {
            return Err(rule("tire_not_found", "tire not found"));
        };
        if from == "mounted" {
            return Err(rule("tire_mounted", "the tire is mounted"));
        }
        if from == to_status {
            return Ok(());
        }
        let now = now_iso();
        a.tx.execute("UPDATE tires SET status=?2 WHERE id=?1", params![tire_id, to_status])?;
        if event_type == "restock" && from == "retreading" {
            a.tx.execute("UPDATE tires SET retread_count = COALESCE(retread_count,0) + 1 WHERE id=?1", params![tire_id])?;
        }
        let event_id = Uuid::new_v4().to_string();
        a.tx.execute(
            "INSERT INTO tire_status_events
               (id, tire_id, event_type, from_status, to_status, notes, occurred_at,
                created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?7,?7,?8,?8,1)",
            params![event_id, tire_id, event_type, from, to_status, clean(notes), now, user_id],
        )?;
        a.inserted("tire_status_events", &event_id)
    })
}

// ═════════════════════════════ chassis ═══════════════════════════════════════

#[derive(Debug, Deserialize, specta::Type)]
pub struct ChassisConfig {
    /// Tractor axles behind the steering axle (dual wheels each).
    pub drive_axles: i64,
    pub trailer_axles: i64,
    pub spares: i64,
    pub single_trailer_axles: Option<bool>,
}

/// Remove a wrong chassis so it can be rebuilt. Refused while any tire is
/// mounted on it.
pub fn chassis_delete(pool: &DbPool, vehicle_id: i64, user_id: i64) -> AppResult<()> {
    write(pool, user_id, |a| {
        let layout: Option<String> = a
            .tx
            .query_row("SELECT id FROM chassis_layouts WHERE vehicle_id=?1 AND deleted_at IS NULL", params![vehicle_id], |r| r.get(0))
            .optional()?;
        let Some(layout_id) = layout else {
            return Err(rule("chassis_not_found", "the vehicle has no chassis layout"));
        };
        let mounted: i64 = a.tx.query_row(
            "SELECT COUNT(*) FROM tire_assignments ta
              JOIN chassis_positions p ON p.id = ta.position_id
             WHERE p.layout_id=?1 AND ta.dismounted_at IS NULL AND ta.deleted_at IS NULL",
            params![layout_id],
            |r| r.get(0),
        )?;
        if mounted > 0 {
            return Err(rule("chassis_in_use", "tires are mounted on this chassis"));
        }
        let ids = |table: &str| -> AppResult<Vec<String>> {
            let mut stmt = a.tx.prepare(&format!("SELECT id FROM {table} WHERE layout_id=?1 AND deleted_at IS NULL"))?;
            let v = stmt.query_map(params![layout_id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            Ok(v)
        };
        // Children first.
        for id in ids("chassis_positions")? {
            a.deleted("chassis_positions", &id)?;
        }
        for id in ids("chassis_axles")? {
            a.deleted("chassis_axles", &id)?;
        }
        a.deleted("chassis_layouts", &layout_id)
    })
}

/// Create a layout + axles + positions for a vehicle in one action. Codes:
///   tractor single H{n}L/R · dual H{n}LO/LI/RI/RO · trailer TR{n}… · spare SP{n}
pub fn chassis_create(pool: &DbPool, vehicle_id: i64, cfg: &ChassisConfig, user_id: i64) -> AppResult<String> {
    let plan = crate::services::chassis_plan::plan_chassis(&crate::services::chassis_plan::PlanConfig {
        drive_axles: cfg.drive_axles,
        trailer_axles: cfg.trailer_axles,
        spares: cfg.spares,
        single_trailer_axles: cfg.single_trailer_axles.unwrap_or(false),
    })
    .map_err(|_| rule("bad_chassis", "invalid chassis configuration"))?;
    write(pool, user_id, |a| {
        let now = now_iso();
        let existing: bool = a.tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM chassis_layouts WHERE vehicle_id=?1 AND deleted_at IS NULL)",
            params![vehicle_id],
            |r| r.get(0),
        )?;
        if existing {
            return Err(rule("chassis_exists", "the vehicle already has a chassis layout"));
        }
        let layout_id = Uuid::new_v4().to_string();
        a.tx.execute(
            "INSERT INTO chassis_layouts
               (id, vehicle_id, name_ar, name_en, created_at, updated_at,
                created_by_user_id, updated_by_user_id, sync_version)
             VALUES (?1,?2,?3,?4,?5,?5,?6,?6,1)",
            params![layout_id, vehicle_id, "الشاسيه", "Chassis", now, user_id],
        )?;
        a.inserted("chassis_layouts", &layout_id)?;

        let mut axle_ids: Vec<String> = Vec::with_capacity(plan.axles.len());
        for ax in &plan.axles {
            let id = Uuid::new_v4().to_string();
            a.tx.execute(
                "INSERT INTO chassis_axles
                   (id, layout_id, section, section_index, axle_type, is_steering, is_lifted,
                    created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
                 VALUES (?1,?2,?3,?4,?5,?6,0,?7,?7,?8,?8,1)",
                params![id, layout_id, ax.section, ax.index, ax.axle_type, ax.is_steering as i64, now, user_id],
            )?;
            a.inserted("chassis_axles", &id)?;
            axle_ids.push(id);
        }
        for p in &plan.positions {
            let id = Uuid::new_v4().to_string();
            let axle_id = p.axle.map(|ix| axle_ids[ix].as_str());
            a.tx.execute(
                "INSERT INTO chassis_positions
                   (id, layout_id, axle_id, side, depth, is_spare, spare_index, position_code,
                    created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,?10,?10,1)",
                params![id, layout_id, axle_id, p.side, p.depth, p.is_spare as i64, p.spare_index, p.code, now, user_id],
            )?;
            a.inserted("chassis_positions", &id)?;
        }
        Ok(layout_id)
    })
}

// ═════════════════════════════ attendance ════════════════════════════════════

/// Namespace of attendance day ids. MUST match maint-rust
/// `rules::ATTENDANCE_DAY_NAMESPACE`: the server refuses any other id.
pub const ATTENDANCE_DAY_NAMESPACE: Uuid = Uuid::from_u128(0x510d161b_3155_4560_9a62_cd726bbed9e9);

/// What a worker's day can be. No "off": the garage has no days off.
pub const ATTENDANCE_STATUSES: &[&str] = &["present", "absent", "leave", "sick"];

/// The one id a worker's day may have: two devices marking the same day meet
/// on it (the first mark stays; the second device is told).
pub fn attendance_day_id(worker_id: &str, work_date: &str) -> AppResult<String> {
    let w = Uuid::parse_str(worker_id.trim()).map_err(|_| rule("not_found", "worker not found"))?;
    Ok(Uuid::new_v5(&ATTENDANCE_DAY_NAMESPACE, format!("{w}:{work_date}").as_bytes()).to_string())
}

fn check_ymd(d: Option<&str>) -> AppResult<Option<String>> {
    match clean(d) {
        None => Ok(None),
        Some(s) => chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d")
            .map(|d| Some(d.format("%Y-%m-%d").to_string()))
            .map_err(|_| rule("bad_date", "not a date")),
    }
}

fn parse_utc(s: &str) -> AppResult<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(s.trim())
        .map(|t| t.with_timezone(&chrono::Utc))
        .map_err(|_| rule("bad_time", "not a time"))
}

/// A garage worker. Only the name is required.
#[derive(Debug, Clone, Deserialize, specta::Type)]
pub struct WorkerInput {
    pub name: String,
    pub job: Option<String>,
    pub phone: Option<String>,
    /// Set when the worker was picked from Falcon's employees.
    pub falcon_employee_id: Option<i64>,
    pub joined_on: Option<String>,
    pub left_on: Option<String>,
    pub notes: Option<String>,
}

struct CleanWorker {
    name: String,
    job: Option<String>,
    phone: Option<String>,
    falcon_employee_id: Option<i64>,
    joined_on: Option<String>,
    left_on: Option<String>,
    notes: Option<String>,
}

fn clean_worker(inp: &WorkerInput) -> AppResult<CleanWorker> {
    let name = clean(Some(&inp.name)).ok_or_else(|| rule("worker_name_required", "a worker needs a name"))?;
    let joined_on = check_ymd(inp.joined_on.as_deref())?;
    let left_on = check_ymd(inp.left_on.as_deref())?;
    if let (Some(j), Some(l)) = (&joined_on, &left_on) {
        if l < j {
            return Err(rule("worker_dates_order", "left before joining"));
        }
    }
    Ok(CleanWorker {
        name,
        job: clean(inp.job.as_deref()),
        phone: clean(inp.phone.as_deref()),
        falcon_employee_id: inp.falcon_employee_id.filter(|n| *n > 0),
        joined_on,
        left_on,
        notes: clean(inp.notes.as_deref()),
    })
}

fn falcon_link_taken(a: &Action<'_>, falcon_id: i64, except: Option<&str>) -> AppResult<bool> {
    Ok(a.tx.query_row(
        "SELECT EXISTS (SELECT 1 FROM attendance_workers
                         WHERE falcon_employee_id = ?1 AND deleted_at IS NULL AND id IS NOT ?2)",
        params![falcon_id, except],
        |r| r.get(0),
    )?)
}

fn worker_insert(a: &Action<'_>, w: &CleanWorker) -> AppResult<String> {
    if let Some(fid) = w.falcon_employee_id {
        if falcon_link_taken(a, fid, None)? {
            return Err(rule("worker_already_added", "this employee is already on the list"));
        }
    }
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    let sort: i64 = a.tx.query_row(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM attendance_workers WHERE deleted_at IS NULL",
        [],
        |r| r.get(0),
    )?;
    a.tx.execute(
        "INSERT INTO attendance_workers
           (id, name, job, phone, falcon_employee_id, joined_on, left_on, sort_order, notes,
            created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10,?11,?11,1)",
        params![id, w.name, w.job, w.phone, w.falcon_employee_id, w.joined_on, w.left_on, sort, w.notes, now, a.user_id],
    )?;
    a.inserted("attendance_workers", &id)?;
    Ok(id)
}

pub fn worker_add(pool: &DbPool, inp: &WorkerInput, user_id: i64) -> AppResult<String> {
    let w = clean_worker(inp)?;
    write(pool, user_id, |a| worker_insert(a, &w))
}

/// Several workers in one action (picked together from Falcon's list).
/// Employees already on the list are skipped, not refused.
pub fn workers_add_many(pool: &DbPool, inputs: &[WorkerInput], user_id: i64) -> AppResult<Vec<String>> {
    let cleaned = inputs.iter().map(clean_worker).collect::<AppResult<Vec<_>>>()?;
    write(pool, user_id, |a| {
        let mut ids = Vec::new();
        for w in &cleaned {
            if let Some(fid) = w.falcon_employee_id {
                if falcon_link_taken(a, fid, None)? {
                    continue;
                }
            }
            ids.push(worker_insert(a, w)?);
        }
        Ok(ids)
    })
}

pub fn worker_update(pool: &DbPool, id: &str, inp: &WorkerInput, user_id: i64) -> AppResult<()> {
    let w = clean_worker(inp)?;
    write(pool, user_id, |a| {
        type Row = (String, Option<String>, Option<String>, Option<i64>, Option<String>, Option<String>, Option<String>);
        let before: Row = a
            .tx
            .query_row(
                "SELECT name, job, phone, falcon_employee_id, joined_on, left_on, notes
                   FROM attendance_workers WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
            )
            .optional()?
            .ok_or_else(|| rule("not_found", "worker not found"))?;
        if let Some(fid) = w.falcon_employee_id {
            if before.3 != Some(fid) && falcon_link_taken(a, fid, Some(id))? {
                return Err(rule("worker_already_added", "this employee is already on the list"));
            }
        }
        let mut cols: Vec<&str> = Vec::new();
        if before.0 != w.name { cols.push("name"); }
        if before.1 != w.job { cols.push("job"); }
        if before.2 != w.phone { cols.push("phone"); }
        if before.3 != w.falcon_employee_id { cols.push("falcon_employee_id"); }
        if before.4 != w.joined_on { cols.push("joined_on"); }
        if before.5 != w.left_on { cols.push("left_on"); }
        if before.6 != w.notes { cols.push("notes"); }
        if cols.is_empty() {
            return Ok(());
        }
        a.tx.execute(
            "UPDATE attendance_workers SET name=?2, job=?3, phone=?4, falcon_employee_id=?5, joined_on=?6,
                    left_on=?7, notes=?8, updated_at=?9, updated_by_user_id=?10
              WHERE id = ?1",
            params![id, w.name, w.job, w.phone, w.falcon_employee_id, w.joined_on, w.left_on, w.notes, now_iso(), a.user_id],
        )?;
        a.updated("attendance_workers", id, &cols)
    })
}

/// Remove a worker typed in by mistake. A worker with marked days keeps them:
/// set the day they left instead (`worker_has_days`).
pub fn worker_delete(pool: &DbPool, id: &str, user_id: i64) -> AppResult<()> {
    write(pool, user_id, |a| {
        let days: i64 = a.tx.query_row(
            "SELECT COUNT(*) FROM attendance_days WHERE worker_id = ?1 AND deleted_at IS NULL",
            params![id],
            |r| r.get(0),
        )?;
        if days > 0 {
            return Err(rule("worker_has_days", "this worker has marked days"));
        }
        a.deleted("attendance_workers", id)
    })
}

/// What a day should say. Quick buttons and the edit dialog both send the
/// whole day; only what changed is queued.
#[derive(Debug, Clone, Deserialize, specta::Type)]
pub struct AttendanceMarkInput {
    pub worker_id: String,
    /// YYYY-MM-DD, Cairo's calendar.
    pub work_date: String,
    pub status: String,
    /// RFC 3339 UTC. Present days only.
    pub check_in_at: Option<String>,
    pub check_out_at: Option<String>,
    pub note: Option<String>,
}

fn mark_inner(a: &Action<'_>, inp: &AttendanceMarkInput, today: chrono::NaiveDate) -> AppResult<()> {
    if !ATTENDANCE_STATUSES.contains(&inp.status.as_str()) {
        return Err(rule("validation", "unknown attendance status"));
    }
    let date = chrono::NaiveDate::parse_from_str(inp.work_date.trim(), "%Y-%m-%d")
        .map_err(|_| rule("bad_date", "not a date"))?;
    if date > today {
        return Err(rule("attendance_future_day", "that day has not come yet"));
    }
    let work_date = date.format("%Y-%m-%d").to_string();
    let worker_live: bool = a.tx.query_row(
        "SELECT EXISTS (SELECT 1 FROM attendance_workers WHERE id = ?1 AND deleted_at IS NULL)",
        params![inp.worker_id],
        |r| r.get(0),
    )?;
    if !worker_live {
        return Err(rule("not_found", "worker not found"));
    }
    let present = inp.status == "present";
    let fmt = |t: chrono::DateTime<chrono::Utc>| t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let cin = if present { clean(inp.check_in_at.as_deref()).map(|s| parse_utc(&s)).transpose()? } else { None };
    let cout = if present { clean(inp.check_out_at.as_deref()).map(|s| parse_utc(&s)).transpose()? } else { None };
    if let (Some(i), Some(o)) = (cin, cout) {
        if o <= i {
            return Err(rule("attendance_out_before_in", "check-out before check-in"));
        }
        if o - i > chrono::Duration::hours(18) {
            return Err(rule("attendance_too_long", "more than 18 hours"));
        }
    }
    if let Some(o) = cout {
        if o > chrono::Utc::now() + chrono::Duration::minutes(5) {
            return Err(rule("attendance_future_time", "that time has not come yet"));
        }
    }
    if let Some(i) = cin {
        if i > chrono::Utc::now() + chrono::Duration::minutes(5) {
            return Err(rule("attendance_future_time", "that time has not come yet"));
        }
    }
    let cin = cin.map(fmt);
    let cout = cout.map(fmt);
    let note = clean(inp.note.as_deref());
    let id = attendance_day_id(&inp.worker_id, &work_date)?;
    let now = now_iso();

    type Row = (String, Option<String>, Option<String>, Option<String>);
    let before: Option<Row> = a
        .tx
        .query_row(
            "SELECT status, check_in_at, check_out_at, note FROM attendance_days WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    match before {
        None => {
            a.tx.execute(
                "INSERT INTO attendance_days
                   (id, worker_id, work_date, status, check_in_at, check_out_at, note,
                    created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8,?9,?9,1)",
                params![id, inp.worker_id, work_date, inp.status, cin, cout, note, now, a.user_id],
            )?;
            a.inserted("attendance_days", &id)
        }
        Some(b) => {
            let mut cols: Vec<&str> = Vec::new();
            if b.0 != inp.status { cols.push("status"); }
            if b.1 != cin { cols.push("check_in_at"); }
            if b.2 != cout { cols.push("check_out_at"); }
            if b.3 != note { cols.push("note"); }
            if cols.is_empty() {
                return Ok(());
            }
            a.tx.execute(
                "UPDATE attendance_days SET status=?2, check_in_at=?3, check_out_at=?4, note=?5,
                        updated_at=?6, updated_by_user_id=?7
                  WHERE id = ?1",
                params![id, inp.status, cin, cout, note, now, a.user_id],
            )?;
            a.updated("attendance_days", &id, &cols)
        }
    }
}

pub fn attendance_mark(pool: &DbPool, inp: &AttendanceMarkInput, user_id: i64) -> AppResult<()> {
    let today = crate::services::views::cairo_today();
    write(pool, user_id, |a| mark_inner(a, inp, today))
}

/// Several days in one action ("the rest present").
pub fn attendance_mark_many(pool: &DbPool, inputs: &[AttendanceMarkInput], user_id: i64) -> AppResult<u32> {
    let today = crate::services::views::cairo_today();
    write(pool, user_id, |a| {
        for inp in inputs {
            mark_inner(a, inp, today)?;
        }
        Ok(inputs.len() as u32)
    })
}
