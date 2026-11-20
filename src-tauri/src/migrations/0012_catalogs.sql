-- Catalogs behind the pickers (server migration 0024): tire products, oil
-- products, standard jobs. Mirrors, replaced by a reference refresh.
-- The link columns on tires / oil changes / tasks are set by the SERVER (it
-- resolves the text to a catalog row); the app stores them when they come
-- back in a pull and never sends them.
CREATE TABLE IF NOT EXISTS tire_products (
    id       TEXT PRIMARY KEY,
    brand    TEXT NOT NULL,
    model    TEXT NOT NULL DEFAULT '',
    size     TEXT NOT NULL DEFAULT '',
    tires    INTEGER NOT NULL DEFAULT 0,
    on_hand  INTEGER
);
CREATE TABLE IF NOT EXISTS oil_products (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    uses     INTEGER NOT NULL DEFAULT 0,
    on_hand  REAL
);
CREATE TABLE IF NOT EXISTS standard_jobs (
    id           TEXT PRIMARY KEY,
    name_ar      TEXT NOT NULL,
    name_en      TEXT,
    category_id  TEXT,
    uses         INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE tires            ADD COLUMN tire_product_id TEXT;
ALTER TABLE oil_changes      ADD COLUMN oil_product_id  TEXT;
ALTER TABLE work_order_tasks ADD COLUMN standard_job_id TEXT;
-- Fetch every row again so the links arrive.
DELETE FROM sync_state WHERE entity_type IN ('tires', 'oil_changes', 'work_order_tasks');
