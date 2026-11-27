//! Garage attendance: the day register, the month sheet, the worker list.
//!
//! A day is one status (present, absent, leave, sick); a present day keeps
//! its check-in and check-out times as recorded. No working hours, no
//! lateness, no hour totals and no days off: the garage works every day. What
//! a day counts as is decided here and only here on the device; React renders
//! what this returns. Cairo's calendar throughout.

use std::collections::{HashMap, HashSet};

use chrono::{Datelike, NaiveDate, Utc};
use chrono_tz::Africa::Cairo;
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::db::DbPool;
use crate::AppResult;

use super::*;

/// Today in Cairo.
pub fn cairo_today() -> NaiveDate {
    Utc::now().with_timezone(&Cairo).date_naive()
}

// ── workers ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AttendanceWorkerRow {
    pub id: String,
    pub name: String,
    pub job: Option<String>,
    pub phone: Option<String>,
    pub falcon_employee_id: Option<i64>,
    pub joined_on: Option<String>,
    pub left_on: Option<String>,
    pub notes: Option<String>,
    /// On the register today (not before joining, not after leaving).
    pub current: bool,
    pub day_count: i64,
    pub pending: bool,
}

struct WorkerBase {
    id: String,
    name: String,
    job: Option<String>,
    joined_on: Option<NaiveDate>,
    left_on: Option<NaiveDate>,
}

impl WorkerBase {
    fn on_register(&self, d: NaiveDate) -> bool {
        self.joined_on.map(|j| j <= d).unwrap_or(true) && self.left_on.map(|l| l >= d).unwrap_or(true)
    }
}

fn ymd(s: Option<String>) -> Option<NaiveDate> {
    s.and_then(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok())
}

fn load_workers(conn: &Connection) -> AppResult<Vec<WorkerBase>> {
    let mut stmt = conn.prepare(
        "SELECT id, COALESCE(name, ''), job, joined_on, left_on FROM attendance_workers
          WHERE deleted_at IS NULL ORDER BY sort_order, name COLLATE NOCASE, id",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(WorkerBase {
                id: r.get(0)?,
                name: r.get(1)?,
                job: r.get(2)?,
                joined_on: ymd(r.get(3)?),
                left_on: ymd(r.get(4)?),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn attendance_workers(pool: &DbPool) -> AppResult<Vec<AttendanceWorkerRow>> {
    let conn = pool.get()?;
    let today = cairo_today();
    let pending = pending_ids(&conn, "attendance_workers")?;
    let mut stmt = conn.prepare(
        "SELECT w.id, COALESCE(w.name, ''), w.job, w.phone, w.falcon_employee_id, w.joined_on, w.left_on, w.notes,
                (SELECT COUNT(*) FROM attendance_days d WHERE d.worker_id = w.id AND d.deleted_at IS NULL)
           FROM attendance_workers w
          WHERE w.deleted_at IS NULL
          ORDER BY w.sort_order, w.name COLLATE NOCASE, w.id",
    )?;
    let mut rows = stmt
        .query_map([], |r| {
            let joined: Option<String> = r.get(5)?;
            let left: Option<String> = r.get(6)?;
            let current = ymd(joined.clone()).map(|j| j <= today).unwrap_or(true)
                && ymd(left.clone()).map(|l| l >= today).unwrap_or(true);
            Ok(AttendanceWorkerRow {
                id: r.get(0)?,
                name: r.get(1)?,
                job: r.get(2)?,
                phone: r.get(3)?,
                falcon_employee_id: r.get(4)?,
                joined_on: joined,
                left_on: left,
                notes: r.get(7)?,
                current,
                day_count: r.get(8)?,
                pending: false,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for w in &mut rows {
        w.pending = pending.contains(&w.id);
    }
    // Current workers first, in their order; those who left after.
    rows.sort_by_key(|w| !w.current);
    Ok(rows)
}

// ── one day ─────────────────────────────────────────────────────────────────

struct DayRec {
    id: String,
    worker_id: String,
    work_date: String,
    status: String,
    check_in_at: Option<String>,
    check_out_at: Option<String>,
    note: Option<String>,
}

fn load_days(conn: &Connection, from: &str, to: &str) -> AppResult<Vec<DayRec>> {
    let mut stmt = conn.prepare(
        "SELECT id, worker_id, work_date, status, check_in_at, check_out_at, note FROM attendance_days
          WHERE deleted_at IS NULL AND work_date >= ?1 AND work_date <= ?2",
    )?;
    let rows = stmt
        .query_map(params![from, to], |r| {
            Ok(DayRec {
                id: r.get(0)?,
                worker_id: r.get(1)?,
                work_date: r.get(2)?,
                status: r.get(3)?,
                check_in_at: r.get(4)?,
                check_out_at: r.get(5)?,
                note: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AttendanceDayRow {
    pub worker_id: String,
    pub name: String,
    pub job: Option<String>,
    /// None = not marked yet.
    pub status: Option<String>,
    pub check_in_at: Option<String>,
    pub check_out_at: Option<String>,
    pub note: Option<String>,
    /// A present day in the past with no check-out.
    pub missing_out: bool,
    pub pending: bool,
}

#[derive(Debug, Clone, Default, Serialize, specta::Type)]
pub struct AttendanceCounts {
    pub present: i64,
    pub absent: i64,
    pub leave: i64,
    pub sick: i64,
    pub unmarked: i64,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AttendanceDayView {
    pub date: String,
    /// ISO weekday, 1 = Monday.
    pub weekday: i64,
    pub is_today: bool,
    pub today: String,
    pub rows: Vec<AttendanceDayRow>,
    pub counts: AttendanceCounts,
    /// Workers exist at all (an empty day may just be before anyone joined).
    pub has_workers: bool,
}

pub fn attendance_day(pool: &DbPool, date: &str) -> AppResult<AttendanceDayView> {
    let conn = pool.get()?;
    let today = cairo_today();
    let d = NaiveDate::parse_from_str(date.trim(), "%Y-%m-%d").unwrap_or(today).min(today);
    let key = d.format("%Y-%m-%d").to_string();
    let workers = load_workers(&conn)?;
    let days: HashMap<String, DayRec> =
        load_days(&conn, &key, &key)?.into_iter().map(|r| (r.worker_id.clone(), r)).collect();
    let pending = pending_ids(&conn, "attendance_days")?;
    let mut counts = AttendanceCounts::default();
    let mut rows = Vec::new();
    for w in &workers {
        let rec = days.get(&w.id);
        // A worker outside their dates still shows when the day was marked.
        if rec.is_none() && !w.on_register(d) {
            continue;
        }
        let (status, cin, cout, note, pend) = match rec {
            Some(r) => (Some(r.status.clone()), r.check_in_at.clone(), r.check_out_at.clone(), r.note.clone(), pending.contains(&r.id)),
            None => (None, None, None, None, false),
        };
        let present = status.as_deref() == Some("present");
        match status.as_deref() {
            Some("present") => counts.present += 1,
            Some("absent") => counts.absent += 1,
            Some("leave") => counts.leave += 1,
            Some("sick") => counts.sick += 1,
            _ => counts.unmarked += 1,
        }
        rows.push(AttendanceDayRow {
            worker_id: w.id.clone(),
            name: w.name.clone(),
            job: w.job.clone(),
            missing_out: present && d < today && cin.is_some() && cout.is_none(),
            status,
            check_in_at: cin,
            check_out_at: cout,
            note,
            pending: pend,
        });
    }
    Ok(AttendanceDayView {
        date: key,
        weekday: d.weekday().number_from_monday() as i64,
        is_today: d == today,
        today: today.format("%Y-%m-%d").to_string(),
        rows,
        counts,
        has_workers: !workers.is_empty(),
    })
}

// ── one month ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AttendanceMonthDay {
    pub date: String,
    pub day: i64,
    pub weekday: i64,
    pub is_today: bool,
    pub is_future: bool,
}

/// What one square of the sheet shows: present, absent, leave, sick,
/// unmarked, future, outside (before joining / after leaving).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AttendanceMonthCell {
    pub kind: String,
    pub check_in_at: Option<String>,
    pub check_out_at: Option<String>,
    pub note: Option<String>,
    pub pending: bool,
}

#[derive(Debug, Clone, Default, Serialize, specta::Type)]
pub struct AttendanceTotals {
    pub present: i64,
    pub absent: i64,
    pub leave: i64,
    pub sick: i64,
    pub unmarked: i64,
}

impl AttendanceTotals {
    fn add(&mut self, o: &AttendanceTotals) {
        self.present += o.present;
        self.absent += o.absent;
        self.leave += o.leave;
        self.sick += o.sick;
        self.unmarked += o.unmarked;
    }
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AttendanceMonthWorker {
    pub worker_id: String,
    pub name: String,
    pub job: Option<String>,
    pub cells: Vec<AttendanceMonthCell>,
    pub totals: AttendanceTotals,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AttendanceMonthView {
    /// YYYY-MM
    pub month: String,
    pub first: String,
    pub last: String,
    pub is_current: bool,
    pub days: Vec<AttendanceMonthDay>,
    pub workers: Vec<AttendanceMonthWorker>,
    pub totals: AttendanceTotals,
}

fn month_bounds(month: &str) -> Option<(NaiveDate, NaiveDate)> {
    let first = NaiveDate::parse_from_str(&format!("{}-01", month.trim()), "%Y-%m-%d").ok()?;
    let next = if first.month() == 12 {
        NaiveDate::from_ymd_opt(first.year() + 1, 1, 1)?
    } else {
        NaiveDate::from_ymd_opt(first.year(), first.month() + 1, 1)?
    };
    Some((first, next.pred_opt()?))
}

pub fn attendance_month(pool: &DbPool, month: &str) -> AppResult<AttendanceMonthView> {
    let conn = pool.get()?;
    let today = cairo_today();
    let (first, last) = month_bounds(month).unwrap_or_else(|| {
        month_bounds(&today.format("%Y-%m").to_string()).expect("this month has bounds")
    });
    let workers = load_workers(&conn)?;
    let from = first.format("%Y-%m-%d").to_string();
    let to = last.format("%Y-%m-%d").to_string();
    let recs = load_days(&conn, &from, &to)?;
    let pending = pending_ids(&conn, "attendance_days")?;
    let marked: HashSet<&str> = recs.iter().map(|r| r.worker_id.as_str()).collect();
    let by_key: HashMap<(String, String), &DayRec> =
        recs.iter().map(|r| ((r.worker_id.clone(), r.work_date.clone()), r)).collect();

    let dates: Vec<NaiveDate> = first.iter_days().take_while(|d| *d <= last).collect();
    let days: Vec<AttendanceMonthDay> = dates
        .iter()
        .map(|d| AttendanceMonthDay {
            date: d.format("%Y-%m-%d").to_string(),
            day: d.day() as i64,
            weekday: d.weekday().number_from_monday() as i64,
            is_today: *d == today,
            is_future: *d > today,
        })
        .collect();

    let mut all = AttendanceTotals::default();
    let mut out = Vec::new();
    for w in &workers {
        let overlaps = w.joined_on.map(|j| j <= last).unwrap_or(true) && w.left_on.map(|l| l >= first).unwrap_or(true);
        if !overlaps && !marked.contains(w.id.as_str()) {
            continue;
        }
        let mut totals = AttendanceTotals::default();
        let mut cells = Vec::with_capacity(dates.len());
        for d in &dates {
            let key = d.format("%Y-%m-%d").to_string();
            let cell = match by_key.get(&(w.id.clone(), key)) {
                Some(r) => {
                    match r.status.as_str() {
                        "present" => totals.present += 1,
                        "absent" => totals.absent += 1,
                        "leave" => totals.leave += 1,
                        "sick" => totals.sick += 1,
                        _ => {}
                    }
                    AttendanceMonthCell {
                        kind: r.status.clone(),
                        check_in_at: r.check_in_at.clone(),
                        check_out_at: r.check_out_at.clone(),
                        note: r.note.clone(),
                        pending: pending.contains(&r.id),
                    }
                }
                None => {
                    let kind = if *d > today {
                        "future"
                    } else if !w.on_register(*d) {
                        "outside"
                    } else {
                        totals.unmarked += 1;
                        "unmarked"
                    };
                    AttendanceMonthCell {
                        kind: kind.to_string(),
                        check_in_at: None,
                        check_out_at: None,
                        note: None,
                        pending: false,
                    }
                }
            };
            cells.push(cell);
        }
        all.add(&totals);
        out.push(AttendanceMonthWorker { worker_id: w.id.clone(), name: w.name.clone(), job: w.job.clone(), cells, totals });
    }
    Ok(AttendanceMonthView {
        month: first.format("%Y-%m").to_string(),
        first: from,
        last: to,
        is_current: first.year() == today.year() && first.month() == today.month(),
        days,
        workers: out,
        totals: all,
    })
}

// ── Falcon's employees ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AttendanceEmployeeRow {
    pub id: i64,
    pub name: String,
    pub kind: Option<String>,
    pub is_active: bool,
    /// Already on the garage's list.
    pub added: bool,
    /// Falcon's free-text type reads like a garage job.
    pub looks_garage: bool,
}

pub fn looks_garage(kind: &str) -> bool {
    let k = fold_search(kind).to_lowercase();
    ["GARAGE", "WORKSHOP", "MECHANIC", "ورش", "جراج", "ميكانيك", "كهربا"]
        .iter()
        .any(|w| k.contains(&w.to_lowercase()))
}

pub fn attendance_employees(pool: &DbPool) -> AppResult<Vec<AttendanceEmployeeRow>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT e.id, e.name, e.type, e.is_active,
                EXISTS (SELECT 1 FROM attendance_workers w WHERE w.falcon_employee_id = e.id AND w.deleted_at IS NULL)
           FROM employees_cache e
          ORDER BY e.is_active DESC, e.name COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map([], |r| {
            let kind: Option<String> = r.get(2)?;
            Ok(AttendanceEmployeeRow {
                id: r.get(0)?,
                name: r.get(1)?,
                looks_garage: kind.as_deref().map(looks_garage).unwrap_or(false),
                kind: kind.filter(|k| !k.trim().is_empty()),
                is_active: r.get::<_, i64>(3)? != 0,
                added: r.get::<_, i64>(4)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Replace the employee mirror with Falcon's current list.
pub fn replace_employees(pool: &DbPool, rows: &[serde_json::Value]) -> AppResult<usize> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM employees_cache", [])?;
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut n = 0;
    for e in rows {
        let (Some(id), Some(name)) = (e.get("id").and_then(|v| v.as_i64()), e.get("name").and_then(|v| v.as_str())) else {
            continue;
        };
        tx.execute(
            "INSERT OR REPLACE INTO employees_cache (id, name, type, is_active, fetched_at) VALUES (?1,?2,?3,?4,?5)",
            params![
                id,
                name,
                e.get("type").and_then(|v| v.as_str()),
                e.get("is_active").and_then(|v| v.as_bool()).unwrap_or(true) as i64,
                now
            ],
        )?;
        n += 1;
    }
    tx.commit()?;
    Ok(n)
}

#[cfg(test)]
mod rule_tests {
    use super::*;

    #[test]
    fn garage_types_are_recognised() {
        assert!(looks_garage("garage"));
        assert!(looks_garage("Garage worker"));
        assert!(looks_garage("ورشة"));
        assert!(looks_garage("ميكانيكي"));
        assert!(!looks_garage("office"));
        assert!(!looks_garage("محاسب"));
    }
}

#[cfg(test)]
mod flow_tests {
    use super::*;
    use crate::services::domain::{self, AttendanceMarkInput, WorkerInput};

    fn pool() -> DbPool {
        let dir = std::env::temp_dir().join(format!("apex-att-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = DbPool::open(&dir.join("t.db")).unwrap();
        p.run_migrations().unwrap();
        p
    }
    fn worker(name: &str) -> WorkerInput {
        WorkerInput { name: name.into(), job: None, phone: None, falcon_employee_id: None, joined_on: None, left_on: None, notes: None }
    }
    fn mark(w: &str, date: &str, status: &str, cin: Option<&str>, cout: Option<&str>) -> AttendanceMarkInput {
        AttendanceMarkInput {
            worker_id: w.into(),
            work_date: date.into(),
            status: status.into(),
            check_in_at: cin.map(Into::into),
            check_out_at: cout.map(Into::into),
            note: None,
        }
    }
    fn outbox(pool: &DbPool, entity: &str) -> Vec<(String, String, String)> {
        let conn = pool.get().unwrap();
        let mut stmt = conn
            .prepare("SELECT entity_id, op, payload FROM outbox WHERE entity_type = ?1 ORDER BY seq")
            .unwrap();
        let rows = stmt
            .query_map(params![entity], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        rows
    }
    fn code(e: crate::AppError) -> String {
        match e {
            crate::AppError::Rule { code, .. } => code.to_string(),
            other => panic!("expected a rule, got {other:?}"),
        }
    }

    #[test]
    fn a_worker_needs_only_a_name_and_is_queued() {
        let p = pool();
        let id = domain::worker_add(&p, &worker("  Test Worker "), 7).unwrap();
        let q = outbox(&p, "attendance_workers");
        assert_eq!(q.len(), 1);
        assert_eq!((q[0].0.as_str(), q[0].1.as_str()), (id.as_str(), "insert"));
        assert!(q[0].2.contains("\"name\":\"Test Worker\""));
        assert_eq!(code(domain::worker_add(&p, &worker("   "), 7).unwrap_err()), "worker_name_required");
        let mut w = worker("Dates");
        w.joined_on = Some("2026-05-01".into());
        w.left_on = Some("2026-04-01".into());
        assert_eq!(code(domain::worker_add(&p, &w, 7).unwrap_err()), "worker_dates_order");
    }

    #[test]
    fn falcon_employees_are_added_once() {
        let p = pool();
        let mut w = worker("From Falcon");
        w.falcon_employee_id = Some(12);
        let ids = domain::workers_add_many(&p, &[w.clone(), w.clone()], 7).unwrap();
        assert_eq!(ids.len(), 1, "the second copy is skipped");
        assert_eq!(code(domain::worker_add(&p, &w, 7).unwrap_err()), "worker_already_added");
    }

    #[test]
    fn marking_a_day_uses_the_worker_and_date_id_and_queues_only_changes() {
        let p = pool();
        let w = domain::worker_add(&p, &worker("Marked"), 7).unwrap();
        domain::attendance_mark(&p, &mark(&w, "2026-01-10", "present", Some("2026-01-10T06:30:00Z"), None), 7).unwrap();
        let id = domain::attendance_day_id(&w, "2026-01-10").unwrap();
        domain::attendance_mark(
            &p,
            &mark(&w, "2026-01-10", "present", Some("2026-01-10T06:30:00Z"), Some("2026-01-10T15:00:00Z")),
            7,
        )
        .unwrap();
        // The same mark again changes nothing and queues nothing.
        domain::attendance_mark(
            &p,
            &mark(&w, "2026-01-10", "present", Some("2026-01-10T06:30:00Z"), Some("2026-01-10T15:00:00Z")),
            7,
        )
        .unwrap();
        // The edit folds into the insert that has not been sent yet; the
        // repeat queues nothing.
        let q = outbox(&p, "attendance_days");
        assert_eq!(q.len(), 1, "{q:?}");
        assert_eq!((q[0].0.as_str(), q[0].1.as_str()), (id.as_str(), "insert"));
        assert!(q[0].2.contains("\"check_out_at\":\"2026-01-10T15:00:00.000Z\""), "{}", q[0].2);
        // Once sent, a change queues only what changed.
        p.get().unwrap().execute("UPDATE outbox SET status = 'acked' WHERE entity_type = 'attendance_days'", []).unwrap();
        domain::attendance_mark(
            &p,
            &mark(&w, "2026-01-10", "present", Some("2026-01-10T06:30:00Z"), Some("2026-01-10T15:30:00Z")),
            7,
        )
        .unwrap();
        let q = outbox(&p, "attendance_days");
        let v: serde_json::Value = serde_json::from_str(&q.last().unwrap().2).unwrap();
        assert_eq!(q.last().unwrap().1, "update");
        assert!(v.get("check_out_at").is_some() && v.get("status").is_none() && v.get("check_in_at").is_none(), "{v}");
        // Absent drops the times.
        domain::attendance_mark(&p, &mark(&w, "2026-01-10", "absent", Some("2026-01-10T06:30:00Z"), None), 7).unwrap();
        let day = attendance_day(&p, "2026-01-10").unwrap();
        let row = &day.rows[0];
        assert_eq!(row.status.as_deref(), Some("absent"));
        assert!(row.check_in_at.is_none() && row.check_out_at.is_none());
    }

    #[test]
    fn the_rules_refuse_bad_days() {
        let p = pool();
        let w = domain::worker_add(&p, &worker("Rules"), 7).unwrap();
        let e = domain::attendance_mark(&p, &mark(&w, "2099-01-01", "absent", None, None), 7).unwrap_err();
        assert_eq!(code(e), "attendance_future_day");
        let e = domain::attendance_mark(
            &p,
            &mark(&w, "2026-01-10", "present", Some("2026-01-10T10:00:00Z"), Some("2026-01-10T09:00:00Z")),
            7,
        )
        .unwrap_err();
        assert_eq!(code(e), "attendance_out_before_in");
        let e = domain::attendance_mark(
            &p,
            &mark(&w, "2026-01-10", "present", Some("2026-01-10T04:00:00Z"), Some("2026-01-11T00:00:00Z")),
            7,
        )
        .unwrap_err();
        assert_eq!(code(e), "attendance_too_long");
        let e = domain::attendance_mark(&p, &mark(&w, "2026-01-10", "napping", None, None), 7).unwrap_err();
        assert_eq!(code(e), "validation");
        // The garage has no days off.
        let e = domain::attendance_mark(&p, &mark(&w, "2026-01-10", "off", None, None), 7).unwrap_err();
        assert_eq!(code(e), "validation");
        // A check-out after midnight belongs to the day it started.
        domain::attendance_mark(
            &p,
            &mark(&w, "2026-01-10", "present", Some("2026-01-10T18:00:00Z"), Some("2026-01-10T23:30:00Z")),
            7,
        )
        .unwrap();
    }

    #[test]
    fn the_day_and_month_follow_join_and_leave_dates_and_have_no_days_off() {
        let p = pool();
        let mut a = worker("Always");
        a.joined_on = None;
        let a = domain::worker_add(&p, &a, 7).unwrap();
        let mut late = worker("Joined mid-month");
        late.joined_on = Some("2026-01-15".into());
        let late = domain::worker_add(&p, &late, 7).unwrap();
        domain::attendance_mark(
            &p,
            &mark(&a, "2026-01-10", "present", Some("2026-01-10T06:20:00Z"), Some("2026-01-10T14:30:00Z")),
            7,
        )
        .unwrap();
        domain::attendance_mark(&p, &mark(&a, "2026-01-11", "sick", None, None), 7).unwrap();

        let day = attendance_day(&p, "2026-01-10").unwrap();
        assert_eq!(day.rows.len(), 1, "the mid-month joiner is not on the list yet");
        assert_eq!(day.rows[0].check_out_at.as_deref(), Some("2026-01-10T14:30:00.000Z"));
        assert_eq!(day.counts.present, 1);

        let m = attendance_month(&p, "2026-01").unwrap();
        assert_eq!(m.days.len(), 31);
        let wa = m.workers.iter().find(|w| w.worker_id == a).unwrap();
        assert_eq!(wa.totals.present, 1);
        assert_eq!(wa.totals.sick, 1);
        // Every day is a working day: 31 − 2 marked = 29 not marked.
        assert_eq!(wa.totals.unmarked, 29);
        assert_eq!(wa.cells[8].kind, "unmarked", "9 January 2026 is a Friday, not a day off");
        let wl = m.workers.iter().find(|w| w.worker_id == late).unwrap();
        assert_eq!(wl.cells[0].kind, "outside");
        assert_eq!(wl.cells[14].kind, "unmarked");
    }

    #[test]
    fn a_worker_with_days_is_not_deleted() {
        let p = pool();
        let w = domain::worker_add(&p, &worker("Keep"), 7).unwrap();
        domain::attendance_mark(&p, &mark(&w, "2026-01-10", "absent", None, None), 7).unwrap();
        assert_eq!(code(domain::worker_delete(&p, &w, 7).unwrap_err()), "worker_has_days");
        let gone = domain::worker_add(&p, &worker("Typo"), 7).unwrap();
        domain::worker_delete(&p, &gone, 7).unwrap();
        assert_eq!(attendance_workers(&p).unwrap().len(), 1);
    }

    #[test]
    fn the_day_id_matches_the_servers() {
        // Pinned against maint-rust rules::attendance_day_id.
        let id = domain::attendance_day_id("3f2504e0-4f89-41d3-9a0c-0305e82c3301", "2026-01-10").unwrap();
        let expect = uuid::Uuid::new_v5(
            &uuid::Uuid::from_u128(0x510d161b_3155_4560_9a62_cd726bbed9e9),
            b"3f2504e0-4f89-41d3-9a0c-0305e82c3301:2026-01-10",
        );
        assert_eq!(id, expect.to_string());
        // Upper case in, the same id out.
        assert_eq!(domain::attendance_day_id("3F2504E0-4F89-41D3-9A0C-0305E82C3301", "2026-01-10").unwrap(), id);
    }
}
