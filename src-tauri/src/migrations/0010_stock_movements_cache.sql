-- Local mirror of the server-owned stock movements ledger, so the movements
-- view (filter / time-range / pagination) works offline. Reads always hit
-- this table; an online refresh upserts the latest window from maint-rust.
CREATE TABLE IF NOT EXISTS stock_movements_cache (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,       -- tire_debit | oil_debit | tire_credit | oil_credit | adjustment
    brand         TEXT,
    model         TEXT,
    size          TEXT,
    oil_type      TEXT,
    qty           INTEGER,
    liters        REAL,
    work_order_id TEXT,
    plate         TEXT,
    created_at    TEXT NOT NULL,       -- server ISO-8601 (lexically ordered)
    mirrored      INTEGER NOT NULL DEFAULT 0,
    fetched_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_smc_created ON stock_movements_cache(created_at DESC);
