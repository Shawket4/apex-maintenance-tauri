-- =========================================================
-- 0003_sync_conflicts.sql
-- Store server-side conflicts for user resolution per §7.5.
-- =========================================================

-- Fix: Outbox needs to store the local sync_version for push
ALTER TABLE sync_outbox ADD COLUMN sync_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS sync_conflicts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    outbox_id       INTEGER NOT NULL UNIQUE REFERENCES sync_outbox(id) ON DELETE CASCADE,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    local_row_json  TEXT NOT NULL, -- JSON
    server_row_json TEXT NOT NULL, -- JSON
    resolved_at     TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_pending ON sync_conflicts(created_at) WHERE resolved_at IS NULL;
