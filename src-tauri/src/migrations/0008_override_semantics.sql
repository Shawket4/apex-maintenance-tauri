-- Mirror of maint-rust 0014: the override records the Falcon reading it
-- corrected (superseded_km), so the arbitration can discard that reading
-- until the truck genuinely drives past it.
ALTER TABLE vehicle_odometer_overrides ADD COLUMN superseded_km INTEGER;
