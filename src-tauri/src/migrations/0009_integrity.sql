-- 2026-07-23 review integrity fixes.
--
-- 1. The two partial unique indexes 0001 defined were lost when 0005
--    recreated tire_assignments — the core mount invariant (one active
--    assignment per position AND per tire) had no local enforcement.
--    Defense-in-depth alongside the domain-layer guards.
CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_one_active_per_position
    ON tire_assignments(position_id)
 WHERE dismounted_at IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_one_active_per_tire
    ON tire_assignments(tire_id)
 WHERE dismounted_at IS NULL AND deleted_at IS NULL;

-- 2. The 0001 views survived 0005 but reference tables/columns 0005 dropped
--    (maintenance_templates/records, tires.purchase_cost, …). SQLite resolves
--    view bodies at query time, so they were runtime landmines with zero
--    callers.
DROP VIEW IF EXISTS v_maintenance_due;
DROP VIEW IF EXISTS v_tire_lifetime;
DROP VIEW IF EXISTS v_tires_list;
