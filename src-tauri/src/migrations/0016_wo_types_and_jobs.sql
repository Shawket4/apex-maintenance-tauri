-- A task names a typed-in maintenance type by its name too (maint-rust 0029):
-- the server creates the type from it.
ALTER TABLE work_order_tasks ADD COLUMN category_name_ar TEXT;
