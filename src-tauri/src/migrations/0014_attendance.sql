-- Garage attendance (2026-11-27). Owned tables, the same shape as the
-- server's (maint-rust 0027); plus the Falcon employee list the garage picks
-- workers from.
CREATE TABLE attendance_workers (
    id TEXT PRIMARY KEY, name TEXT, job TEXT, phone TEXT, falcon_employee_id INTEGER,
    joined_on TEXT, left_on TEXT, sort_order INTEGER DEFAULT 0, notes TEXT,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);

-- id = UUID v5 of "<worker_id>:<work_date>" (one row per worker per day).
CREATE TABLE attendance_days (
    id TEXT PRIMARY KEY, worker_id TEXT, work_date TEXT, status TEXT,
    check_in_at TEXT, check_out_at TEXT, note TEXT,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);
CREATE INDEX idx_attendance_days_date ON attendance_days(work_date);
CREATE INDEX idx_attendance_days_worker ON attendance_days(worker_id, work_date);

-- One row, id = 1. No row = the defaults.
CREATE TABLE attendance_settings (
    id INTEGER PRIMARY KEY, work_start TEXT, work_end TEXT, late_grace_minutes INTEGER,
    weekly_off_days TEXT,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);

-- Falcon's employees (id, name, type, active) — replaced by each refresh.
CREATE TABLE employees_cache (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT, is_active INTEGER NOT NULL DEFAULT 1,
    fetched_at TEXT
);
