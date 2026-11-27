//! Garage attendance: the day register, the month sheet, the worker list.
//!
//! The rule (late, worked hours, what a day counts as) lives here and only
//! here on the device; React renders what this returns. Cairo's calendar and
//! clock throughout, summer time included — never a fixed offset.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Datelike, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use chrono_tz::Africa::Cairo;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::db::DbPool;
use crate::AppResult;

use super::*;

pub const DEFAULT_WORK_START: &str = "08:00";
pub const DEFAULT_WORK_END: &str = "17:00";
pub const DEFAULT_GRACE_MINUTES: i64 = 15;
/// Friday.
pub const DEFAULT_WEEKLY_OFF: &[i64] = &[5];

/// Today in Cairo.
pub fn cairo_today() -> NaiveDate {
    Utc::now().with_timezone(&Cairo).date_naive()
}

/// A stored UTC instant as Cairo wall-clock time.
pub fn cairo_local(iso: &str) -> Option<NaiveDateTime> {
    DateTime::parse_from_rfc3339(iso).ok().map(|t| t.with_timezone(&Cairo).naive_local())
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AttendanceSettingsView {
    pub work_start: String,
    pub work_end: String,
    pub late_grace_minutes: i64,
    pub weekly_off_days: Vec<i64>,
    /// False until someone saves the hours: the defaults are showing.
    pub saved: bool,
    pub pending: bool,
}

impl AttendanceSettingsView {
    fn start(&self) -> NaiveTime {
        NaiveTime::parse_from_str(&self.work_start, "%H:%M").unwrap_or(NaiveTime::from_hms_opt(8, 0, 0).unwrap())
    }
    fn end(&self) -> NaiveTime {
        NaiveTime::parse_from_str(&self.work_end, "%H:%M").unwrap_or(NaiveTime::from_hms_opt(17, 0, 0).unwrap())
    }
    /// Length of the working day in minutes (an end before the start wraps
    /// past midnight).
    fn day_minutes(&self) -> i64 {
        let m = (self.end() - self.start()).num_minutes();
        if m <= 0 { m + 24 * 60 } else { m }
    }
    fn is_off(&self, d: NaiveDate) -> bool {
        self.weekly_off_days.contains(&(d.weekday().number_from_monday() as i64))
    }
}

fn load_settings(conn: &Connection) -> AppResult<AttendanceSettingsView> {
    let row: Option<(Option<String>, Option<String>, Option<i64>, Option<String>)> = conn
        .query_row(
            "SELECT work_start, work_end, late_grace_minutes, weekly_off_days
               FROM attendance_settings WHERE id = 1 AND deleted_at IS NULL",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let pending = pending_ids(conn, "attendance_settings")?.contains("1");
    Ok(match row {
        None => AttendanceSettingsView {
            work_start: DEFAULT_WORK_START.into(),
            work_end: DEFAULT_WORK_END.into(),
            late_grace_minutes: DEFAULT_GRACE_MINUTES,
            weekly_off_days: DEFAULT_WEEKLY_OFF.to_vec(),
            saved: false,
            pending,
        },
        Some((s, e, g, off)) => AttendanceSettingsView {
            work_start: s.unwrap_or_else(|| DEFAULT_WORK_START.into()),
            work_end: e.unwrap_or_else(|| DEFAULT_WORK_END.into()),
            late_grace_minutes: g.unwrap_or(DEFAULT_GRACE_MINUTES),
            weekly_off_days: off
                .map(|o| o.split(',').filter_map(|d| d.trim().parse().ok()).collect())
                .unwrap_or_else(|| DEFAULT_WEEKLY_OFF.to_vec()),
            saved: true,
            pending,
        },
    })
}

pub fn attendance_settings(pool: &DbPool) -> AppResult<AttendanceSettingsView> {
    let conn = pool.get()?;
    load_settings(&conn)
}

// ── the rule ────────────────────────────────────────────────────────────────

/// What one marked day amounts to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DayFigures {
    /// Minutes after the start of the working day; 0 within the grace.
    pub late_minutes: i64,
    /// Check-out minus check-in; None without both.
    pub worked_minutes: Option<i64>,
    /// Worked beyond the length of the working day.
    pub extra_minutes: i64,
}

/// No one is late on the weekly day off: whoever came in, came in extra.
pub fn day_figures(
    s: &AttendanceSettingsView,
    work_date: NaiveDate,
    check_in_at: Option<&str>,
    check_out_at: Option<&str>,
) -> DayFigures {
    let cin = check_in_at.and_then(cairo_local);
    let cout = check_out_at.and_then(cairo_local);
    let late_minutes = cin
        .filter(|_| !s.is_off(work_date))
        .map(|i| (i - work_date.and_time(s.start())).num_minutes())
        .filter(|m| *m > s.late_grace_minutes)
        .unwrap_or(0);
    let worked_minutes = match (cin, cout) {
        (Some(i), Some(o)) if o > i => Some((o - i).num_minutes()),
        _ => None,
    };
    let extra_minutes = worked_minutes.map(|w| (w - s.day_minutes()).max(0)).unwrap_or(0);
    DayFigures { late_minutes, worked_minutes, extra_minutes }
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
    pub late_minutes: i64,
    pub worked_minutes: Option<i64>,
    /// A present day in the past with no check-out.
    pub missing_out: bool,
    pub pending: bool,
}

#[derive(Debug, Clone, Default, Serialize, specta::Type)]
pub struct AttendanceCounts {
    pub present: i64,
    pub late: i64,
    pub absent: i64,
    pub leave: i64,
    pub sick: i64,
    pub off: i64,
    pub unmarked: i64,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AttendanceDayView {
    pub date: String,
    /// ISO weekday, 1 = Monday.
    pub weekday: i64,
    pub is_today: bool,
    pub is_weekly_off: bool,
    pub today: String,
    pub settings: AttendanceSettingsView,
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
    let settings = load_settings(&conn)?;
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
        let fig = day_figures(&settings, d, cin.as_deref(), cout.as_deref());
        let present = status.as_deref() == Some("present");
        match status.as_deref() {
            Some("present") => {
                counts.present += 1;
                if fig.late_minutes > 0 {
                    counts.late += 1;
                }
            }
            Some("absent") => counts.absent += 1,
            Some("leave") => counts.leave += 1,
            Some("sick") => counts.sick += 1,
            Some("off") => counts.off += 1,
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
            late_minutes: fig.late_minutes,
            worked_minutes: fig.worked_minutes,
            pending: pend,
        });
    }
    Ok(AttendanceDayView {
        date: key,
        weekday: d.weekday().number_from_monday() as i64,
        is_today: d == today,
        is_weekly_off: settings.is_off(d),
        today: today.format("%Y-%m-%d").to_string(),
        settings,
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
    pub is_weekly_off: bool,
    pub is_today: bool,
    pub is_future: bool,
}

/// What one square of the sheet shows: present, late, absent, leave, sick,
/// off (marked), weekly_off, unmarked, future, outside (before joining /
/// after leaving).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AttendanceMonthCell {
    pub kind: String,
    pub check_in_at: Option<String>,
    pub check_out_at: Option<String>,
    pub note: Option<String>,
    pub late_minutes: i64,
    pub worked_minutes: Option<i64>,
    pub pending: bool,
}

#[derive(Debug, Clone, Default, Serialize, specta::Type)]
pub struct AttendanceTotals {
    /// Present days, late ones included.
    pub present: i64,
    pub late: i64,
    pub late_minutes: i64,
    pub absent: i64,
    pub leave: i64,
    pub sick: i64,
    /// Marked off for the day, not the weekly day off.
    pub off: i64,
    pub unmarked: i64,
    pub worked_minutes: i64,
    pub extra_minutes: i64,
}

impl AttendanceTotals {
    fn add(&mut self, o: &AttendanceTotals) {
        self.present += o.present;
        self.late += o.late;
        self.late_minutes += o.late_minutes;
        self.absent += o.absent;
        self.leave += o.leave;
        self.sick += o.sick;
        self.off += o.off;
        self.unmarked += o.unmarked;
        self.worked_minutes += o.worked_minutes;
        self.extra_minutes += o.extra_minutes;
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
    pub settings: AttendanceSettingsView,
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
    let settings = load_settings(&conn)?;
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
            is_weekly_off: settings.is_off(*d),
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
                    let fig = day_figures(&settings, *d, r.check_in_at.as_deref(), r.check_out_at.as_deref());
                    let kind = match r.status.as_str() {
                        "present" if fig.late_minutes > 0 => "late",
                        s => s,
                    };
                    match r.status.as_str() {
                        "present" => {
                            totals.present += 1;
                            if fig.late_minutes > 0 {
                                totals.late += 1;
                                totals.late_minutes += fig.late_minutes;
                            }
                            totals.worked_minutes += fig.worked_minutes.unwrap_or(0);
                            totals.extra_minutes += fig.extra_minutes;
                        }
                        "absent" => totals.absent += 1,
                        "leave" => totals.leave += 1,
                        "sick" => totals.sick += 1,
                        "off" => totals.off += 1,
                        _ => {}
                    }
                    AttendanceMonthCell {
                        kind: kind.to_string(),
                        check_in_at: r.check_in_at.clone(),
                        check_out_at: r.check_out_at.clone(),
                        note: r.note.clone(),
                        late_minutes: fig.late_minutes,
                        worked_minutes: fig.worked_minutes,
                        pending: pending.contains(&r.id),
                    }
                }
                None => {
                    let kind = if *d > today {
                        "future"
                    } else if !w.on_register(*d) {
                        "outside"
                    } else if settings.is_off(*d) {
                        "weekly_off"
                    } else {
                        totals.unmarked += 1;
                        "unmarked"
                    };
                    AttendanceMonthCell {
                        kind: kind.to_string(),
                        check_in_at: None,
                        check_out_at: None,
                        note: None,
                        late_minutes: 0,
                        worked_minutes: None,
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
        settings,
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

    fn s() -> AttendanceSettingsView {
        AttendanceSettingsView {
            work_start: "08:00".into(),
            work_end: "17:00".into(),
            late_grace_minutes: 15,
            weekly_off_days: vec![5],
            saved: true,
            pending: false,
        }
    }
    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn late_counts_from_the_start_once_past_the_grace() {
        // Winter: Cairo is UTC+2. 08:15 is within the grace, 08:16 is late by 16.
        assert_eq!(day_figures(&s(), d("2026-01-10"), Some("2026-01-10T06:15:00Z"), None).late_minutes, 0);
        assert_eq!(day_figures(&s(), d("2026-01-10"), Some("2026-01-10T06:16:00Z"), None).late_minutes, 16);
        // Summer time: Cairo is UTC+3, so 05:30 UTC is 08:30 local: late by 30.
        assert_eq!(day_figures(&s(), d("2026-07-11"), Some("2026-07-11T05:30:00Z"), None).late_minutes, 30);
        // Early is not negative lateness.
        assert_eq!(day_figures(&s(), d("2026-01-10"), Some("2026-01-10T05:00:00Z"), None).late_minutes, 0);
        // Friday is the day off: coming in at noon is not lateness.
        assert_eq!(day_figures(&s(), d("2026-01-09"), Some("2026-01-09T10:00:00Z"), None).late_minutes, 0);
    }

    #[test]
    fn worked_and_extra_minutes_cross_midnight() {
        let f = day_figures(&s(), d("2026-01-10"), Some("2026-01-10T06:00:00Z"), Some("2026-01-10T22:30:00Z"));
        assert_eq!(f.worked_minutes, Some(16 * 60 + 30));
        assert_eq!(f.extra_minutes, 16 * 60 + 30 - 9 * 60);
        let f = day_figures(&s(), d("2026-01-10"), Some("2026-01-10T06:00:00Z"), None);
        assert_eq!((f.worked_minutes, f.extra_minutes), (None, 0));
    }

    #[test]
    fn friday_is_the_default_day_off() {
        assert!(s().is_off(d("2026-11-27")));
        assert!(!s().is_off(d("2026-11-28")));
    }

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
    use crate::services::domain::{self, AttendanceMarkInput, AttendanceSettingsInput, WorkerInput};

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
    }

    #[test]
    fn the_day_and_month_follow_join_and_leave_dates_and_the_hours() {
        let p = pool();
        let mut a = worker("Always");
        a.joined_on = None;
        let a = domain::worker_add(&p, &a, 7).unwrap();
        let mut late = worker("Joined mid-month");
        late.joined_on = Some("2026-01-15".into());
        let late = domain::worker_add(&p, &late, 7).unwrap();
        domain::attendance_settings_set(
            &p,
            &AttendanceSettingsInput {
                work_start: "08:00".into(),
                work_end: "16:00".into(),
                late_grace_minutes: 10,
                weekly_off_days: vec![5],
            },
            7,
        )
        .unwrap();
        // 08:20 Cairo (winter, UTC+2): late by 20; out 16:30 → 8h10m, 10m extra.
        domain::attendance_mark(
            &p,
            &mark(&a, "2026-01-10", "present", Some("2026-01-10T06:20:00Z"), Some("2026-01-10T14:30:00Z")),
            7,
        )
        .unwrap();
        domain::attendance_mark(&p, &mark(&a, "2026-01-11", "sick", None, None), 7).unwrap();

        let day = attendance_day(&p, "2026-01-10").unwrap();
        assert_eq!(day.rows.len(), 1, "the mid-month joiner is not on the list yet");
        assert_eq!(day.rows[0].late_minutes, 20);
        assert_eq!(day.counts.present, 1);
        assert_eq!(day.counts.late, 1);

        let m = attendance_month(&p, "2026-01").unwrap();
        assert_eq!(m.days.len(), 31);
        let wa = m.workers.iter().find(|w| w.worker_id == a).unwrap();
        assert_eq!(wa.totals.present, 1);
        assert_eq!(wa.totals.late, 1);
        assert_eq!(wa.totals.late_minutes, 20);
        assert_eq!(wa.totals.sick, 1);
        assert_eq!(wa.totals.worked_minutes, 8 * 60 + 10);
        assert_eq!(wa.totals.extra_minutes, 10);
        // January 2026 has five Fridays; 31 − 5 off − 2 marked = 24 not marked.
        assert_eq!(wa.totals.unmarked, 24);
        assert_eq!(wa.cells[8].kind, "weekly_off", "9 January 2026 is a Friday");
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
