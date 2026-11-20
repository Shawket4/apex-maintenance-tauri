-- A stock movement can be a count correction, and says who recorded it.
ALTER TABLE stock_movements_cache ADD COLUMN is_count  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stock_movements_cache ADD COLUMN user_name TEXT;
