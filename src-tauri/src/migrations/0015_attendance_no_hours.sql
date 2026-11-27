-- Attendance without working hours or days off (2026-11-27), as on the server
-- (maint-rust 0028). The settings row is gone and nothing about it is left to
-- send; a day marked off is absent, here and in what is still queued.
DROP TABLE IF EXISTS attendance_settings;
DELETE FROM outbox WHERE entity_type = 'attendance_settings' AND status IN ('pending', 'inflight', 'dead');
DELETE FROM sync_state WHERE entity_type = 'attendance_settings';
UPDATE attendance_days SET status = 'absent' WHERE status = 'off';
UPDATE outbox SET payload = json_set(payload, '$.status', 'absent')
 WHERE entity_type = 'attendance_days' AND status IN ('pending', 'inflight', 'dead')
   AND json_extract(payload, '$.status') = 'off';
