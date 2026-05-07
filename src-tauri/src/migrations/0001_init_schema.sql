-- =========================================================
-- 0001_init_schema.sql
-- Apex Maintenance — client-side SQLite mirror of the maint-rust schema.
-- Mappings from Postgres per architecture §6:
--   UUID         -> TEXT (36-char string, generated client-side)
--   JSONB        -> TEXT (JSON string)
--   TIMESTAMPTZ  -> TEXT (ISO-8601 UTC, e.g. '2026-05-04T13:21:00Z')
--   DATE         -> TEXT ('YYYY-MM-DD')
--   NUMERIC      -> REAL
--   BIGINT       -> INTEGER
--   ENUMs        -> TEXT CHECK (col IN (...))
-- =========================================================

-- ---------------------------------------------------------
-- 1. CACHE MIRRORS (read-only from app's perspective)
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS vehicles_cache (
    id                              INTEGER PRIMARY KEY,
    car_no_plate                    TEXT NOT NULL,
    car_type                        TEXT,
    transporter                     TEXT,
    tank_capacity                   INTEGER,
    json_compartments               TEXT,                -- JSON
    license_expiration_date         TEXT,                -- DATE
    calibration_expiration_date     TEXT,
    tank_license_expiration_date    TEXT,
    is_in_trip                      INTEGER NOT NULL DEFAULT 0,
    is_approved                     INTEGER NOT NULL DEFAULT 0,
    location                        TEXT,
    lat                             REAL,
    long                            REAL,
    location_time_stamp             TEXT,
    engine_status                   TEXT,
    speed                           INTEGER,
    last_fuel_odometer              INTEGER,
    last_oil_change_id              INTEGER,
    driver_id                       INTEGER,
    operating_company               TEXT,
    operating_area                  TEXT,
    geo_fence                       TEXT,
    slack_status                    TEXT,
    last_updated_slack_status       TEXT,
    etit_car_id                     TEXT,
    car_license_url                 TEXT,
    car_license_back_url            TEXT,
    calibration_license_url         TEXT,
    calibration_license_back_url    TEXT,
    tank_license_url                TEXT,
    tank_license_back_url           TEXT,
    raw_payload                     TEXT NOT NULL,        -- JSON
    source_created_at               TEXT,
    source_updated_at               TEXT,
    source_deleted_at               TEXT,
    fetched_at                      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vehicles_cache_plate  ON vehicles_cache(car_no_plate);
CREATE INDEX IF NOT EXISTS idx_vehicles_cache_active ON vehicles_cache(id) WHERE source_deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS drivers_cache (
    id                                  INTEGER PRIMARY KEY,
    name                                TEXT NOT NULL,
    mobile_number                       TEXT,
    transporter                         TEXT,
    id_license_expiration_date          TEXT,
    driver_license_expiration_date      TEXT,
    safety_license_expiration_date      TEXT,
    drug_test_expiration_date           TEXT,
    is_approved                         INTEGER NOT NULL DEFAULT 0,
    raw_payload                         TEXT NOT NULL,
    source_created_at                   TEXT,
    source_updated_at                   TEXT,
    fetched_at                          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_invoices_cache (
    id                          INTEGER PRIMARY KEY,
    car_id                      INTEGER NOT NULL,
    driver_name                 TEXT,
    date                        TEXT,
    meter_reading               INTEGER,
    plate_number                TEXT,
    supervisor                  TEXT,
    operating_region            TEXT,
    raw_payload                 TEXT NOT NULL,
    source_created_at           TEXT,
    source_updated_at           TEXT,
    source_deleted_at           TEXT,
    fetched_at                  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_cache_car  ON service_invoices_cache(car_id);
CREATE INDEX IF NOT EXISTS idx_invoices_cache_date ON service_invoices_cache(date DESC);

CREATE TABLE IF NOT EXISTS service_invoice_items_cache (
    id                          INTEGER PRIMARY KEY,
    service_invoice_id          INTEGER NOT NULL,
    service                     TEXT NOT NULL,
    notes                       TEXT,
    item_order                  INTEGER,
    raw_payload                 TEXT NOT NULL,
    source_created_at           TEXT,
    source_updated_at           TEXT,
    fetched_at                  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON service_invoice_items_cache(service_invoice_id);

-- ---------------------------------------------------------
-- 2. FTS5 — service_invoice_items search (offline fallback per §4.3)
-- ---------------------------------------------------------

CREATE VIRTUAL TABLE IF NOT EXISTS service_invoice_items_fts USING fts5(
    service,
    notes,
    content='service_invoice_items_cache',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS siic_ai AFTER INSERT ON service_invoice_items_cache BEGIN
    INSERT INTO service_invoice_items_fts(rowid, service, notes)
    VALUES (new.id, new.service, new.notes);
END;

CREATE TRIGGER IF NOT EXISTS siic_au AFTER UPDATE ON service_invoice_items_cache BEGIN
    INSERT INTO service_invoice_items_fts(service_invoice_items_fts, rowid, service, notes)
    VALUES ('delete', old.id, old.service, old.notes);
    INSERT INTO service_invoice_items_fts(rowid, service, notes)
    VALUES (new.id, new.service, new.notes);
END;

CREATE TRIGGER IF NOT EXISTS siic_ad AFTER DELETE ON service_invoice_items_cache BEGIN
    INSERT INTO service_invoice_items_fts(service_invoice_items_fts, rowid, service, notes)
    VALUES ('delete', old.id, old.service, old.notes);
END;

-- ---------------------------------------------------------
-- 3. OWNED DATA — maintenance scheduling
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS maintenance_categories (
    id          TEXT PRIMARY KEY,
    name_ar     TEXT NOT NULL,
    name_en     TEXT NOT NULL,
    icon        TEXT,
    color       TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS maintenance_templates (
    id                      TEXT PRIMARY KEY,                -- UUIDv4 (client-generated)
    vehicle_id              INTEGER NOT NULL,
    category_id             TEXT NOT NULL REFERENCES maintenance_categories(id),
    name_ar                 TEXT NOT NULL,
    name_en                 TEXT NOT NULL,
    notes_ar                TEXT,
    notes_en                TEXT,
    trigger_type            TEXT NOT NULL CHECK (trigger_type IN ('mileage','time')),
    interval_km             INTEGER,
    interval_days           INTEGER,
    lead_warn_km            INTEGER NOT NULL DEFAULT 500,
    lead_warn_days          INTEGER NOT NULL DEFAULT 14,
    is_active               INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL,
    deleted_at              TEXT,
    created_by_user_id      INTEGER NOT NULL,
    updated_by_user_id      INTEGER NOT NULL,
    sync_version            INTEGER NOT NULL DEFAULT 1,
    CHECK (
        (trigger_type = 'mileage' AND interval_km  IS NOT NULL AND interval_km  > 0) OR
        (trigger_type = 'time'    AND interval_days IS NOT NULL AND interval_days > 0)
    )
);
CREATE INDEX IF NOT EXISTS idx_templates_vehicle ON maintenance_templates(vehicle_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS maintenance_records (
    id                      TEXT PRIMARY KEY,
    template_id             TEXT REFERENCES maintenance_templates(id),
    vehicle_id              INTEGER NOT NULL,
    category_id             TEXT NOT NULL REFERENCES maintenance_categories(id),
    performed_at            TEXT NOT NULL,
    odometer_at_service     INTEGER,
    next_due_at             TEXT,
    next_due_km             INTEGER,
    cost                    REAL,
    vendor                  TEXT,
    performed_by            TEXT,
    notes                   TEXT,
    attachments             TEXT NOT NULL DEFAULT '[]',
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL,
    deleted_at              TEXT,
    created_by_user_id      INTEGER NOT NULL,
    updated_by_user_id      INTEGER NOT NULL,
    sync_version            INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_records_vehicle_date ON maintenance_records(vehicle_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_template     ON maintenance_records(template_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS vehicle_odometer_overrides (
    vehicle_id              INTEGER PRIMARY KEY,
    odometer                INTEGER NOT NULL CHECK (odometer >= 0),
    set_at                  TEXT NOT NULL,
    notes                   TEXT,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL,
    created_by_user_id      INTEGER NOT NULL,
    updated_by_user_id      INTEGER NOT NULL,
    sync_version            INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------
-- 4. OWNED DATA — chassis & tires
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS chassis_layouts (
    id                      TEXT PRIMARY KEY,
    vehicle_id              INTEGER NOT NULL UNIQUE,
    name_ar                 TEXT,
    name_en                 TEXT,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL,
    deleted_at              TEXT,
    created_by_user_id      INTEGER NOT NULL,
    updated_by_user_id      INTEGER NOT NULL,
    sync_version            INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS chassis_axles (
    id                      TEXT PRIMARY KEY,
    layout_id               TEXT NOT NULL REFERENCES chassis_layouts(id) ON DELETE CASCADE,
    section                 TEXT NOT NULL CHECK (section IN ('tractor','trailer')),
    section_index           INTEGER NOT NULL,
    axle_type               TEXT NOT NULL CHECK (axle_type IN ('single','dual')),
    label_ar                TEXT,
    label_en                TEXT,
    is_steering             INTEGER NOT NULL DEFAULT 0,
    is_lifted               INTEGER NOT NULL DEFAULT 0,
    UNIQUE (layout_id, section, section_index)
);

CREATE TABLE IF NOT EXISTS chassis_positions (
    id                      TEXT PRIMARY KEY,
    layout_id               TEXT NOT NULL REFERENCES chassis_layouts(id) ON DELETE CASCADE,
    axle_id                 TEXT REFERENCES chassis_axles(id) ON DELETE CASCADE,
    side                    TEXT CHECK (side IS NULL OR side IN ('left','right')),
    depth                   TEXT CHECK (depth IS NULL OR depth IN ('single','inner','outer')),
    is_spare                INTEGER NOT NULL DEFAULT 0,
    spare_index             INTEGER,
    position_code           TEXT NOT NULL,
    UNIQUE (layout_id, position_code),
    CHECK (
        (is_spare = 0 AND axle_id IS NOT NULL AND side IS NOT NULL AND depth IS NOT NULL)
     OR (is_spare = 1 AND axle_id IS NULL     AND spare_index IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_positions_layout ON chassis_positions(layout_id);
CREATE INDEX IF NOT EXISTS idx_positions_axle   ON chassis_positions(axle_id);

CREATE TABLE IF NOT EXISTS tires (
    id                      TEXT PRIMARY KEY,
    dot_code                TEXT NOT NULL UNIQUE,
    internal_serial         TEXT,
    brand                   TEXT NOT NULL,
    model                   TEXT,
    purchase_date           TEXT,
    purchase_cost           REAL,
    supplier                TEXT,
    production_week         INTEGER CHECK (production_week  IS NULL OR production_week  BETWEEN 1 AND 53),
    production_year         INTEGER CHECK (production_year  IS NULL OR production_year  BETWEEN 2000 AND 2099),
    production_date         TEXT,
    is_retread              INTEGER NOT NULL DEFAULT 0,
    retread_count           INTEGER NOT NULL DEFAULT 0,
    parent_tire_id          TEXT REFERENCES tires(id),
    status                  TEXT NOT NULL DEFAULT 'in_stock'
                                CHECK (status IN ('in_stock','mounted','in_repair','retreading','scrapped')),
    stock_location          TEXT,
    scrap_reason            TEXT,
    scrap_date              TEXT,
    notes                   TEXT,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL,
    deleted_at              TEXT,
    created_by_user_id      INTEGER NOT NULL,
    updated_by_user_id      INTEGER NOT NULL,
    sync_version            INTEGER NOT NULL DEFAULT 1,
    CHECK ((production_week IS NULL) = (production_year IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_tires_dot              ON tires(dot_code);
CREATE INDEX IF NOT EXISTS idx_tires_status_brand     ON tires(status, brand) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tires_stock_location   ON tires(stock_location)
    WHERE deleted_at IS NULL AND status = 'in_stock';
CREATE INDEX IF NOT EXISTS idx_tires_production       ON tires(production_year, production_week);

CREATE TABLE IF NOT EXISTS tire_assignments (
    id                      TEXT PRIMARY KEY,
    tire_id                 TEXT NOT NULL REFERENCES tires(id),
    position_id             TEXT NOT NULL REFERENCES chassis_positions(id),
    vehicle_id              INTEGER NOT NULL,
    mounted_at              TEXT NOT NULL,
    mounted_odometer        INTEGER,
    dismounted_at           TEXT,
    dismounted_odometer     INTEGER,
    mount_reason            TEXT NOT NULL CHECK (mount_reason IN
        ('new_install','rotation','replacement','puncture','wear','damage','retread_return')),
    dismount_reason         TEXT CHECK (dismount_reason IS NULL OR dismount_reason IN
        ('new_install','rotation','replacement','puncture','wear','damage','retread_return')),
    notes                   TEXT,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL,
    deleted_at              TEXT,
    created_by_user_id      INTEGER NOT NULL,
    updated_by_user_id      INTEGER NOT NULL,
    sync_version            INTEGER NOT NULL DEFAULT 1,
    CHECK (dismounted_at IS NULL OR dismounted_at >= mounted_at),
    CHECK (
        dismounted_odometer IS NULL OR mounted_odometer IS NULL
        OR dismounted_odometer >= mounted_odometer
    )
);
CREATE INDEX IF NOT EXISTS idx_assignments_tire     ON tire_assignments(tire_id);
CREATE INDEX IF NOT EXISTS idx_assignments_position ON tire_assignments(position_id);
CREATE INDEX IF NOT EXISTS idx_assignments_vehicle  ON tire_assignments(vehicle_id);

-- One active assignment per position
CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_one_active_per_position
    ON tire_assignments(position_id) WHERE dismounted_at IS NULL AND deleted_at IS NULL;

-- A tire is mounted in at most one place
CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_one_active_per_tire
    ON tire_assignments(tire_id) WHERE dismounted_at IS NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------
-- 5. SYNC INFRASTRUCTURE (SQLite-only) per §6.1
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS sync_outbox (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    operation       TEXT NOT NULL CHECK (operation IN ('insert','update','delete')),
    payload_json    TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    attempted_at    TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON sync_outbox(created_at) WHERE attempts < 5;

CREATE TABLE IF NOT EXISTS sync_cursors (
    entity_type     TEXT PRIMARY KEY,
    last_pulled_at  TEXT NOT NULL,
    last_pushed_at  TEXT
);

CREATE TABLE IF NOT EXISTS cache_freshness (
    cache_name      TEXT PRIMARY KEY,
    fetched_at      TEXT NOT NULL,
    ttl_seconds     INTEGER NOT NULL,
    is_stale        INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------
-- 6. VIEWS — re-implemented for SQLite per §6
--    GREATEST -> MAX, INTERVAL math -> julianday, etc.
-- ---------------------------------------------------------

DROP VIEW IF EXISTS v_maintenance_due;
CREATE VIEW v_maintenance_due AS
SELECT
    t.id              AS template_id,
    t.vehicle_id,
    t.category_id,
    t.name_ar, t.name_en,
    t.trigger_type,
    t.interval_km, t.interval_days,
    t.lead_warn_km, t.lead_warn_days,
    r.performed_at        AS last_done_at,
    r.odometer_at_service AS last_done_km,
    r.next_due_at,
    r.next_due_km,
    MAX(
        COALESCE(vc.last_fuel_odometer, 0),
        COALESCE(voo.odometer, 0)
    ) AS current_odometer,
    CASE
        WHEN COALESCE(voo.odometer, 0) > COALESCE(vc.last_fuel_odometer, 0)
            THEN 'manual'
        ELSE 'falcon'
    END AS odometer_source,
    CASE
      WHEN r.id IS NULL THEN 'never_done'
      WHEN t.trigger_type = 'mileage' AND r.next_due_km IS NOT NULL THEN
        CASE
          WHEN MAX(COALESCE(vc.last_fuel_odometer, 0), COALESCE(voo.odometer, 0)) >= r.next_due_km
            THEN 'overdue'
          WHEN MAX(COALESCE(vc.last_fuel_odometer, 0), COALESCE(voo.odometer, 0)) >= r.next_due_km - t.lead_warn_km
            THEN 'due_soon'
          ELSE 'ok'
        END
      WHEN t.trigger_type = 'time' AND r.next_due_at IS NOT NULL THEN
        CASE
          WHEN julianday('now') >= julianday(r.next_due_at) THEN 'overdue'
          WHEN julianday('now') >= julianday(r.next_due_at) - t.lead_warn_days THEN 'due_soon'
          ELSE 'ok'
        END
      ELSE 'never_done'
    END AS status
FROM maintenance_templates t
LEFT JOIN maintenance_records r ON r.id = (
    SELECT id FROM maintenance_records mr
    WHERE mr.template_id = t.id AND mr.deleted_at IS NULL
    ORDER BY mr.performed_at DESC LIMIT 1
)
JOIN vehicles_cache vc                    ON vc.id = t.vehicle_id
LEFT JOIN vehicle_odometer_overrides voo  ON voo.vehicle_id = t.vehicle_id
WHERE t.deleted_at IS NULL
  AND t.is_active = 1
  AND vc.source_deleted_at IS NULL;

DROP VIEW IF EXISTS v_tire_lifetime;
CREATE VIEW v_tire_lifetime AS
WITH per_assignment_km AS (
    SELECT
        ta.id,
        ta.tire_id,
        ta.vehicle_id,
        ta.mounted_at,
        CASE
          WHEN ta.dismounted_odometer IS NOT NULL AND ta.mounted_odometer IS NOT NULL
            THEN ta.dismounted_odometer - ta.mounted_odometer
          WHEN ta.dismounted_at IS NULL AND ta.mounted_odometer IS NOT NULL
            THEN MAX(
                   COALESCE(vc.last_fuel_odometer, ta.mounted_odometer),
                   COALESCE(voo.odometer,         ta.mounted_odometer)
                 ) - ta.mounted_odometer
          ELSE 0
        END AS km_on_position
    FROM tire_assignments ta
    LEFT JOIN vehicles_cache vc               ON vc.id  = ta.vehicle_id
    LEFT JOIN vehicle_odometer_overrides voo  ON voo.vehicle_id = ta.vehicle_id
    WHERE ta.deleted_at IS NULL
)
SELECT
    t.id                                    AS tire_id,
    t.dot_code,
    t.brand,
    t.status,
    t.purchase_cost,
    CAST(COALESCE(SUM(pa.km_on_position), 0) AS INTEGER) AS lifetime_km,
    CAST(COUNT(pa.id) AS INTEGER)                        AS installment_count,
    MIN(pa.mounted_at)                                   AS first_mounted_at,
    CASE
      WHEN t.purchase_cost IS NOT NULL AND COALESCE(SUM(pa.km_on_position), 0) > 0
        THEN ROUND(t.purchase_cost / NULLIF(SUM(pa.km_on_position), 0), 4)
      ELSE NULL
    END                                      AS cost_per_km
FROM tires t
LEFT JOIN per_assignment_km pa ON pa.tire_id = t.id
WHERE t.deleted_at IS NULL
GROUP BY t.id, t.dot_code, t.brand, t.status, t.purchase_cost;

DROP VIEW IF EXISTS v_tires_list;
CREATE VIEW v_tires_list AS
SELECT
    t.id,
    t.dot_code,
    t.internal_serial,
    t.brand,
    t.model,
    t.status,
    t.production_week,
    t.production_year,
    t.production_date,
    t.purchase_date,
    t.purchase_cost,
    t.stock_location,
    t.is_retread,
    t.retread_count,
    CASE
      WHEN t.status = 'mounted' THEN
        (SELECT vc.car_no_plate || ' / ' || cp.position_code
           FROM tire_assignments ta
           JOIN chassis_positions cp ON cp.id = ta.position_id
           JOIN vehicles_cache vc    ON vc.id = ta.vehicle_id
          WHERE ta.tire_id = t.id AND ta.dismounted_at IS NULL AND ta.deleted_at IS NULL
          LIMIT 1)
      WHEN t.status = 'in_stock' THEN COALESCE(t.stock_location, 'Unassigned')
      ELSE t.status
    END AS current_location_label,
    EXISTS (
        SELECT 1 FROM tire_assignments ta
        WHERE ta.tire_id = t.id AND ta.deleted_at IS NULL
    ) AS has_history,
    tl.lifetime_km,
    tl.installment_count,
    tl.cost_per_km,
    t.created_at,
    t.updated_at
FROM tires t
LEFT JOIN v_tire_lifetime tl ON tl.tire_id = t.id
WHERE t.deleted_at IS NULL;
