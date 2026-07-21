-- Mirror of maint-rust 0012: dismounts carry their own WO attribution
-- (work_order_id on the assignment belongs to the MOUNT).
ALTER TABLE tire_assignments ADD COLUMN dismount_work_order_id TEXT;
