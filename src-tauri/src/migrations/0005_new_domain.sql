-- Local mirror for the rebuilt domain. SQLite dialect: TEXT for uuid/enum/timestamp,
-- INTEGER for ints/bools, REAL for numeric. Columns MUST match engine::columns_for.
-- The old domain tables are dropped (local mirror only — repopulated by /sync/pull).

-- Drop child tables before parents so FK enforcement (rows may exist) doesn't block.
DROP TABLE IF EXISTS maintenance_records;
DROP TABLE IF EXISTS maintenance_templates;
DROP TABLE IF EXISTS tire_assignments;
DROP TABLE IF EXISTS tire_status_events;
DROP TABLE IF EXISTS tires;
DROP TABLE IF EXISTS chassis_positions;
DROP TABLE IF EXISTS chassis_axles;
DROP TABLE IF EXISTS chassis_layouts;
DROP TABLE IF EXISTS vehicle_odometer_overrides;
DROP TABLE IF EXISTS vehicle_class_assignments;

CREATE TABLE work_orders (
    id TEXT PRIMARY KEY, vehicle_id INTEGER, status TEXT, title TEXT,
    odometer_at_open INTEGER, opened_at TEXT, closed_at TEXT, notes_ar TEXT, notes_en TEXT,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);
CREATE TABLE work_order_tasks (
    id TEXT PRIMARY KEY, work_order_id TEXT, kind TEXT, category_id TEXT,
    description_ar TEXT, description_en TEXT, is_done INTEGER, sort_order INTEGER,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);
CREATE TABLE oil_changes (
    id TEXT PRIMARY KEY, work_order_id TEXT, vehicle_id INTEGER, oil_type TEXT,
    liters REAL, odometer INTEGER, flagged INTEGER, notes TEXT, performed_at TEXT,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);
CREATE TABLE tires (
    id TEXT PRIMARY KEY, dot_code TEXT, brand TEXT, model TEXT, size TEXT,
    status TEXT, origin TEXT, total_km INTEGER, parent_tire_id TEXT, retread_count INTEGER,
    notes_ar TEXT, notes_en TEXT,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);
CREATE TABLE tire_assignments (
    id TEXT PRIMARY KEY, tire_id TEXT, position_id TEXT, vehicle_id INTEGER, work_order_id TEXT,
    mounted_at TEXT, mounted_odometer INTEGER, mount_reason TEXT,
    dismounted_at TEXT, dismounted_odometer INTEGER, dismount_reason TEXT, notes TEXT,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);
CREATE TABLE tire_status_events (
    id TEXT PRIMARY KEY, tire_id TEXT, event_type TEXT, work_order_id TEXT,
    from_status TEXT, to_status TEXT, notes TEXT, occurred_at TEXT,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);
CREATE TABLE chassis_layouts (
    id TEXT PRIMARY KEY, vehicle_id INTEGER, name_ar TEXT, name_en TEXT,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);
CREATE TABLE chassis_axles (
    id TEXT PRIMARY KEY, layout_id TEXT, section TEXT, section_index INTEGER, axle_type TEXT,
    label_ar TEXT, label_en TEXT, is_steering INTEGER, is_lifted INTEGER,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);
CREATE TABLE chassis_positions (
    id TEXT PRIMARY KEY, layout_id TEXT, axle_id TEXT, side TEXT, depth TEXT,
    is_spare INTEGER, spare_index INTEGER, position_code TEXT,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);
CREATE TABLE vehicle_class_assignments (
    vehicle_id INTEGER PRIMARY KEY, class_id TEXT,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);
CREATE TABLE vehicle_odometer_overrides (
    vehicle_id INTEGER PRIMARY KEY, odometer INTEGER, set_at TEXT, notes TEXT,
    created_at TEXT, updated_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);
