-- Batteries (maint-rust 0030/0031): counted per product on the shelf, one
-- record per battery once fitted or registered, numbered slots per truck.

-- Owned (synced) tables, same columns as the server.
CREATE TABLE battery_layouts (
    vehicle_id INTEGER PRIMARY KEY, slots INTEGER,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);
CREATE TABLE batteries (
    id TEXT PRIMARY KEY, battery_product_id TEXT, brand TEXT, model TEXT,
    capacity_ah INTEGER, voltage INTEGER, cca INTEGER,
    serial TEXT, date_code TEXT, warranty_months INTEGER,
    status TEXT, origin TEXT, notes_ar TEXT,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);
CREATE TABLE battery_installs (
    id TEXT PRIMARY KEY, battery_id TEXT, vehicle_id INTEGER, slot INTEGER, work_order_id TEXT,
    installed_at TEXT, installed_odometer INTEGER,
    removed_at TEXT, removed_odometer INTEGER, removal_reason TEXT, removal_outcome TEXT,
    removal_work_order_id TEXT, notes TEXT,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    created_by_user_id INTEGER, updated_by_user_id INTEGER, sync_version INTEGER
);
CREATE INDEX idx_battery_installs_vehicle ON battery_installs(vehicle_id);
CREATE INDEX idx_battery_installs_battery ON battery_installs(battery_id);

-- Server-owned mirrors, replaced wholesale (like tire_stock_cache / tire_products).
CREATE TABLE battery_stock_cache (
    id TEXT PRIMARY KEY, brand TEXT NOT NULL, model TEXT,
    capacity_ah INTEGER, voltage INTEGER, cca INTEGER,
    on_hand_qty INTEGER NOT NULL DEFAULT 0, fetched_at TEXT
);
CREATE TABLE battery_products (
    id TEXT PRIMARY KEY, brand TEXT NOT NULL, model TEXT,
    capacity_ah INTEGER, voltage INTEGER, cca INTEGER,
    batteries INTEGER NOT NULL DEFAULT 0, on_hand INTEGER
);
