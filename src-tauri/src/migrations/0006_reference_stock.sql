-- Reference + stock mirrors. These are NOT sync-pull entities: they are small,
-- server-owned tables replaced wholesale by an online refresh (like
-- vehicles_cache), so they carry no sync columns.
--
-- Stock projection rule: these tables always hold the LAST SERVER SNAPSHOT.
-- Writes never touch them; projected on-hand = snapshot − pending outbox
-- debits, computed at read time (services/domain.rs::stock_view).

DROP TABLE IF EXISTS vehicle_classes;
CREATE TABLE vehicle_classes (
    id          TEXT PRIMARY KEY,
    name_ar     TEXT NOT NULL,
    name_en     TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

DROP TABLE IF EXISTS service_plans;
CREATE TABLE service_plans (
    id              TEXT PRIMARY KEY,
    class_id        TEXT NOT NULL,
    category_id     TEXT NOT NULL,
    trigger_type    TEXT NOT NULL,
    interval_km     INTEGER,
    interval_days   INTEGER,
    lead_warn_km    INTEGER,
    lead_warn_days  INTEGER,
    is_active       INTEGER NOT NULL DEFAULT 1,
    deleted_at      TEXT
);

DROP TABLE IF EXISTS tire_stock_cache;
CREATE TABLE tire_stock_cache (
    id          TEXT PRIMARY KEY,
    brand       TEXT NOT NULL,
    model       TEXT,
    size        TEXT,
    on_hand_qty INTEGER NOT NULL DEFAULT 0,
    fetched_at  TEXT
);

DROP TABLE IF EXISTS oil_stock_cache;
CREATE TABLE oil_stock_cache (
    id              TEXT PRIMARY KEY,
    oil_type        TEXT NOT NULL,
    liters_on_hand  REAL NOT NULL DEFAULT 0,
    fetched_at      TEXT
);
