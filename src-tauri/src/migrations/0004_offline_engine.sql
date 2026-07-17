-- =========================================================================
-- 0004_offline_engine.sql
--
-- 1. Repair schema drift against Postgres: chassis_axles / chassis_positions
--    were mirrored WITHOUT the audit + sync columns, which made every pull of
--    those tables crash (the puller inserts columns that didn't exist here)
--    and made optimistic concurrency structurally impossible for them.
--
-- 2. vehicles_cache gains `mileage` — Falcon's own odometer estimate, synced
--    by the backend since its migration 0010 and required by the local due
--    engine's odometer-truth resolution.
--
-- 3. Replace the dead sync scaffolding (sync_outbox / sync_cursors /
--    sync_conflicts — provably empty in production: nothing ever enqueued)
--    with the real engine's tables:
--
--    outbox      — durable, crash-survivable record of local intent.
--                  One coalesced pending row per entity; FIFO by seq;
--                  two-class retry via next_attempt_at + attempts;
--                  dead rows are VISIBLE (Diagnostics) and hold the server
--                  row on conflict so the user can see both sides.
--    sync_state  — per-entity composite pull cursor (since + after_id).
-- =========================================================================

-- ── 1. chassis drift ──────────────────────────────────────────────────────
ALTER TABLE chassis_axles ADD COLUMN created_at         TEXT    NOT NULL DEFAULT '1970-01-01T00:00:00Z';
ALTER TABLE chassis_axles ADD COLUMN updated_at         TEXT    NOT NULL DEFAULT '1970-01-01T00:00:00Z';
ALTER TABLE chassis_axles ADD COLUMN deleted_at         TEXT;
ALTER TABLE chassis_axles ADD COLUMN created_by_user_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chassis_axles ADD COLUMN updated_by_user_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chassis_axles ADD COLUMN sync_version       INTEGER NOT NULL DEFAULT 1;

ALTER TABLE chassis_positions ADD COLUMN created_at         TEXT    NOT NULL DEFAULT '1970-01-01T00:00:00Z';
ALTER TABLE chassis_positions ADD COLUMN updated_at         TEXT    NOT NULL DEFAULT '1970-01-01T00:00:00Z';
ALTER TABLE chassis_positions ADD COLUMN deleted_at         TEXT;
ALTER TABLE chassis_positions ADD COLUMN created_by_user_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chassis_positions ADD COLUMN updated_by_user_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chassis_positions ADD COLUMN sync_version       INTEGER NOT NULL DEFAULT 1;

-- ── 2. Falcon mileage ─────────────────────────────────────────────────────
ALTER TABLE vehicles_cache ADD COLUMN mileage INTEGER;

-- ── 3. the engine's tables ────────────────────────────────────────────────
DROP TABLE IF EXISTS sync_outbox;
DROP TABLE IF EXISTS sync_cursors;
DROP TABLE IF EXISTS sync_conflicts;

CREATE TABLE outbox (
    seq                 INTEGER PRIMARY KEY AUTOINCREMENT,   -- global FIFO order
    id                  TEXT    NOT NULL UNIQUE,             -- client-minted op uuid
    entity_type         TEXT    NOT NULL,
    entity_id           TEXT    NOT NULL,
    op                  TEXT    NOT NULL CHECK (op IN ('insert','update','delete')),
    payload             TEXT    NOT NULL,                    -- full row snapshot (JSON)
    base_sync_version   INTEGER NOT NULL,                    -- server version this write is based on
    status              TEXT    NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','inflight','acked','dead')),
    attempts            INTEGER NOT NULL DEFAULT 0,
    last_error          TEXT,
    server_row          TEXT,                                -- server's row on conflict dead-letters
    next_attempt_at     INTEGER NOT NULL DEFAULT 0,          -- epoch ms backoff gate (0 = now)
    enqueued_at         TEXT    NOT NULL,
    synced_at           INTEGER,                             -- epoch ms when acked (retention window)
    user_id             INTEGER
);

CREATE INDEX outbox_due ON outbox(status, next_attempt_at, seq);
CREATE INDEX outbox_entity ON outbox(entity_type, entity_id, status);

CREATE TABLE sync_state (
    entity_type     TEXT PRIMARY KEY,
    since           TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z',
    after_id        TEXT,
    last_pulled_at  TEXT
);
