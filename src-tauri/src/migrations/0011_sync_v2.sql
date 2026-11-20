-- Sync engine v2 (2026-11 audit).
--
-- 1. Outbox: every op is sent with its own id (exactly-once on the server),
--    ops of one user action share a group (all-or-nothing on the server),
--    and an op that has been SENT is never rewritten — a later edit queues
--    behind it instead of being folded into a request the server may already
--    have applied (that folding silently lost edits).
-- 2. No more permanent dead letters. A change the server refuses is undone
--    locally and recorded in sync_issues for the user to read; nothing gates
--    the rest of the queue forever.
-- 3. sync_refresh: rows to re-read from the server (after a refusal, or when
--    a pulled row was skipped because local work was still queued for it).
-- 4. Tasks carry done_at — the due clock starts when the task is ticked.
-- 5. The local unique indexes on active mounts are dropped: one pulled row
--    that tripped them aborted every later pull on the device. The domain
--    layer checks before writing and the server is the authority.
-- 6. Indexes the 0005 rebuild never created (the tire list scanned every
--    assignment once per tire).

ALTER TABLE outbox ADD COLUMN group_id   TEXT;
ALTER TABLE outbox ADD COLUMN sent       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbox ADD COLUMN error_code TEXT;
-- Rows queued by an older build may already have reached the server.
UPDATE outbox SET sent = 1 WHERE status IN ('inflight','dead') OR attempts > 0;
CREATE INDEX IF NOT EXISTS outbox_pending_seq ON outbox(status, seq);

CREATE TABLE IF NOT EXISTS sync_issues (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT    NOT NULL,
    entity_type  TEXT    NOT NULL,
    entity_id    TEXT    NOT NULL,
    op           TEXT    NOT NULL,
    code         TEXT    NOT NULL,
    message      TEXT,
    -- What the user had entered, so nothing is lost without a trace.
    detail       TEXT,
    user_id      INTEGER,
    seen         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sync_issues_unseen ON sync_issues(seen, id);

CREATE TABLE IF NOT EXISTS sync_refresh (
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    PRIMARY KEY (entity_type, entity_id)
);

ALTER TABLE work_order_tasks ADD COLUMN done_at TEXT;
UPDATE work_order_tasks
   SET done_at = (SELECT wo.opened_at FROM work_orders wo WHERE wo.id = work_order_tasks.work_order_id)
 WHERE is_done = 1 AND done_at IS NULL;

DROP INDEX IF EXISTS idx_assignments_one_active_per_position;
DROP INDEX IF EXISTS idx_assignments_one_active_per_tire;

CREATE INDEX IF NOT EXISTS idx_ta_tire        ON tire_assignments(tire_id);
CREATE INDEX IF NOT EXISTS idx_ta_position    ON tire_assignments(position_id);
CREATE INDEX IF NOT EXISTS idx_ta_vehicle     ON tire_assignments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_ta_wo          ON tire_assignments(work_order_id);
CREATE INDEX IF NOT EXISTS idx_ta_dismount_wo ON tire_assignments(dismount_work_order_id);
CREATE INDEX IF NOT EXISTS idx_tse_tire       ON tire_status_events(tire_id);
CREATE INDEX IF NOT EXISTS idx_tires_status   ON tires(status);
CREATE INDEX IF NOT EXISTS idx_wot_wo         ON work_order_tasks(work_order_id);
CREATE INDEX IF NOT EXISTS idx_wo_vehicle     ON work_orders(vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_oil_wo         ON oil_changes(work_order_id);
CREATE INDEX IF NOT EXISTS idx_oil_vehicle    ON oil_changes(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_pos_layout     ON chassis_positions(layout_id);
CREATE INDEX IF NOT EXISTS idx_axles_layout   ON chassis_axles(layout_id);
CREATE INDEX IF NOT EXISTS idx_layouts_vehicle ON chassis_layouts(vehicle_id);

-- The pull cursors move to a server whose change feed is now strictly
-- ordered. Start every stream over once so anything an earlier cursor
-- skipped is picked up (rows are upserts; this is safe to repeat).
DELETE FROM sync_state;

-- Stock ledger mirror: who, why, and whether Falcon refused the movement.
ALTER TABLE stock_movements_cache ADD COLUMN note         TEXT;
ALTER TABLE stock_movements_cache ADD COLUMN mirror_error TEXT;

-- Odometer corrections: a Falcon reading counts again only once it CHANGES
-- after the correction. Each reading keeps its own change time.
ALTER TABLE vehicles_cache ADD COLUMN fuel_odometer_changed_at TEXT;
ALTER TABLE vehicles_cache ADD COLUMN mileage_changed_at       TEXT;
UPDATE vehicles_cache SET fuel_odometer_changed_at = fetched_at, mileage_changed_at = fetched_at;
-- On a corrected vehicle, a reading still at or below the corrected value is
-- the stale one: date it before the correction so it stays ignored.
UPDATE vehicles_cache
   SET fuel_odometer_changed_at =
       (SELECT strftime('%Y-%m-%dT%H:%M:%SZ', julianday(o.set_at) - 1.0/86400)
          FROM vehicle_odometer_overrides o WHERE o.vehicle_id = vehicles_cache.id)
 WHERE EXISTS (SELECT 1 FROM vehicle_odometer_overrides o
                WHERE o.vehicle_id = vehicles_cache.id
                  AND COALESCE(vehicles_cache.last_fuel_odometer, 0) <= COALESCE(o.superseded_km, 2147483647));
UPDATE vehicles_cache
   SET mileage_changed_at =
       (SELECT strftime('%Y-%m-%dT%H:%M:%SZ', julianday(o.set_at) - 1.0/86400)
          FROM vehicle_odometer_overrides o WHERE o.vehicle_id = vehicles_cache.id)
 WHERE EXISTS (SELECT 1 FROM vehicle_odometer_overrides o
                WHERE o.vehicle_id = vehicles_cache.id
                  AND COALESCE(vehicles_cache.mileage, 0) <= COALESCE(o.superseded_km, 2147483647));
