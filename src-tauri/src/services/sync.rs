use std::sync::Arc;
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde_json::Value as JsonValue;

use crate::AppResult;
use crate::db::DbPool;
use crate::http_client::HttpClient;
use crate::models::sync::{ConflictRecord, PushBatch, PushBatchResponse, PullResponse, SyncOp, SyncStatus};

pub struct SyncService {
    db: Arc<DbPool>,
    http: Arc<HttpClient>,
}

impl SyncService {
    pub fn new(db: Arc<DbPool>, http: Arc<HttpClient>) -> Self {
        Self { db, http }
    }

    /// Enqueue an operation into the sync outbox per §7.1.
    pub fn enqueue_op(
        &self,
        entity_type: &str,
        entity_id: &str,
        operation: &str,
        payload: JsonValue,
        sync_version: i64,
    ) -> AppResult<()> {
        let conn = self.db.get()?;
        let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        conn.execute(
            "INSERT INTO sync_outbox (entity_type, entity_id, operation, payload_json, created_at, sync_version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                entity_type,
                entity_id,
                operation,
                serde_json::to_string(&payload)?,
                now,
                sync_version
            ],
        )?;

        Ok(())
    }

    /// Drain the outbox and push to server per §7.2.
    pub async fn push_all(&self) -> AppResult<usize> {
        let batch_size: i64 = 50; // APEX_SYNC_PUSH_BATCH_SIZE
        let mut total_applied = 0;

        loop {
            let pending_ops = {
                let conn = self.db.get()?;
                let mut stmt = conn.prepare(
                    "SELECT id, entity_type, entity_id, operation, payload_json, sync_version
                     FROM sync_outbox
                     WHERE attempts < 5 AND id NOT IN (SELECT outbox_id FROM sync_conflicts WHERE resolved_at IS NULL)
                     ORDER BY created_at ASC
                     LIMIT ?1",
                )?;

                let rows = stmt.query_map(params![batch_size], |row| {
                    let id: i64 = row.get(0)?;
                    let entity_type: String = row.get(1)?;
                    let entity_id: String = row.get(2)?;
                    let operation: String = row.get(3)?;
                    let payload_json: String = row.get(4)?;
                    let sync_version: i64 = row.get(5)?;

                    Ok((
                        id,
                        SyncOp {
                            entity_type,
                            entity_id,
                            operation,
                            payload: serde_json::from_str(&payload_json).unwrap_or(JsonValue::Null),
                            sync_version,
                        },
                    ))
                })?;

                let mut collected = Vec::new();
                for r in rows {
                    collected.push(r?);
                }
                collected
            };

            if pending_ops.is_empty() {
                break;
            }

            let ids: Vec<i64> = pending_ops.iter().map(|(id, _)| *id).collect();
            let batch = PushBatch {
                operations: pending_ops.into_iter().map(|(_, op)| op).collect(),
            };

            // Call API
            let response: PushBatchResponse = self.http.post("/sync/push", &batch).await?;

            // Process results
            let mut conn = self.db.get()?;
            let tx = conn.transaction()?;

            for (idx, result) in response.results.iter().enumerate() {
                let outbox_id = ids[idx];
                match result.status.as_str() {
                    "applied" => {
                        // Success: remove from outbox and update local sync_version
                        tx.execute("DELETE FROM sync_outbox WHERE id = ?1", params![outbox_id])?;
                        
                        // Update local sync_version if we have a table mapping
                        if let Some(new_version) = result.new_sync_version {
                            let table_name = get_table_name(&batch.operations[idx].entity_type);
                            let pk_col = get_pk_column(&batch.operations[idx].entity_type);
                            if let (Some(t), Some(pk)) = (table_name, pk_col) {
                                let sql = format!("UPDATE {} SET sync_version = ?1 WHERE {} = ?2", t, pk);
                                tx.execute(&sql, params![new_version, batch.operations[idx].entity_id])?;
                            }
                        }
                        total_applied += 1;
                    }
                    "conflict" => {
                        // Conflict: move to conflicts table
                        let server_row = result.server_row.clone().unwrap_or(JsonValue::Null);
                        let local_row = {
                            let op = &batch.operations[idx];
                            op.payload.clone()
                        };
                        
                        let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                        tx.execute(
                            "INSERT INTO sync_conflicts (outbox_id, entity_type, entity_id, local_row_json, server_row_json, created_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                            params![
                                outbox_id,
                                batch.operations[idx].entity_type,
                                batch.operations[idx].entity_id,
                                serde_json::to_string(&local_row)?,
                                serde_json::to_string(&server_row)?,
                                now
                            ],
                        )?;
                        
                        tx.execute(
                            "UPDATE sync_outbox SET last_error = 'CONFLICT', attempted_at = ?1 WHERE id = ?2",
                            params![now, outbox_id],
                        )?;
                    }
                    "error" => {
                        let msg = result.message.as_deref().unwrap_or("Unknown error");
                        tracing::error!("Sync error for {}:{} -> {}", batch.operations[idx].entity_type, batch.operations[idx].entity_id, msg);
                        
                        // Transient error: increment attempts
                        let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                        tx.execute(
                            "UPDATE sync_outbox SET attempts = attempts + 1, last_error = ?1, attempted_at = ?2 WHERE id = ?3",
                            params!["SERVER_ERROR", now, outbox_id],
                        )?;
                    }
                    _ => {}
                }
            }

            tx.commit()?;
            
            if ids.len() < batch_size as usize {
                break;
            }
        }

        Ok(total_applied)
    }

    /// Pull new data from server per §7.3.
    pub async fn pull_all(&self) -> AppResult<usize> {
        let entity_types = vec![
            "maintenance_templates",
            "maintenance_records",
            "vehicle_odometer_overrides",
            "chassis_layouts",
            "chassis_axles",
            "chassis_positions",
            "tires",
            "tire_assignments",
        ];

        let mut total_pulled = 0;

        for et in entity_types {
            loop {
                let cursor = {
                    let conn = self.db.get()?;
                    conn.query_row(
                        "SELECT last_pulled_at FROM sync_cursors WHERE entity_type = ?1",
                        params![et],
                        |row| row.get::<_, String>(0),
                    ).optional()?.unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string())
                };

                let url = format!("/sync/pull?entity_type={}&since={}&limit=200", et, cursor);
                let response: PullResponse = self.http.get(&url).await?;

                if response.rows.is_empty() {
                    break;
                }

                let mut conn = self.db.get()?;
                let tx = conn.transaction()?;

                for row in &response.rows {
                    apply_pulled_row(&tx, et, row)?;
                    total_pulled += 1;
                }

                // Advance cursor
                if let Some(next) = response.next_cursor {
                    tx.execute(
                        "INSERT INTO sync_cursors (entity_type, last_pulled_at)
                         VALUES (?1, ?2)
                         ON CONFLICT(entity_type) DO UPDATE SET last_pulled_at = excluded.last_pulled_at",
                        params![et, next],
                    )?;
                }

                tx.commit()?;

                if !response.has_more {
                    break;
                }
            }
        }

        Ok(total_pulled)
    }

    pub fn get_status(&self) -> AppResult<SyncStatus> {
        let conn = self.db.get()?;
        let outbox_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sync_outbox WHERE attempts < 5",
            [],
            |r| r.get(0),
        )?;
        let conflict_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sync_conflicts WHERE resolved_at IS NULL",
            [],
            |r| r.get(0),
        )?;
        
        // Last sync at could be the max(last_pulled_at)
        let last_sync_at: Option<String> = conn.query_row(
            "SELECT MAX(last_pulled_at) FROM sync_cursors",
            [],
            |r| r.get(0),
        ).optional()?;

        Ok(SyncStatus {
            outbox_count,
            conflict_count,
            last_sync_at,
        })
    }

    pub fn list_conflicts(&self) -> AppResult<Vec<ConflictRecord>> {
        let conn = self.db.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, outbox_id, entity_type, entity_id, local_row_json, server_row_json, created_at
             FROM sync_conflicts
             WHERE resolved_at IS NULL
             ORDER BY created_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(ConflictRecord {
                id: row.get(0)?,
                outbox_id: row.get(1)?,
                entity_type: row.get(2)?,
                entity_id: row.get(3)?,
                local_row: serde_json::from_str(&row.get::<_, String>(4)?).unwrap_or(JsonValue::Null),
                server_row: serde_json::from_str(&row.get::<_, String>(5)?).unwrap_or(JsonValue::Null),
                created_at: row.get(6)?,
            })
        })?;

        let mut collected = Vec::new();
        for r in rows {
            collected.push(r?);
        }
        Ok(collected)
    }

    pub async fn resolve_conflict(&self, conflict_id: i64, action: &str) -> AppResult<()> {
        let (outbox_id, entity_type, _entity_id, server_row_json) = {
            let conn = self.db.get()?;
            conn.query_row(
                "SELECT outbox_id, entity_type, entity_id, server_row_json FROM sync_conflicts WHERE id = ?1",
                params![conflict_id],
                |row| Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?
                )),
            )?
        };

        let mut conn = self.db.get()?;
        let tx = conn.transaction()?;
        let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        match action {
            "accept_server" => {
                // Apply server row to local DB
                let server_row: JsonValue = serde_json::from_str(&server_row_json).unwrap_or(JsonValue::Null);
                apply_pulled_row(&tx, &entity_type, &server_row)?;
                
                // Remove from outbox (we are giving up our local change)
                tx.execute("DELETE FROM sync_outbox WHERE id = ?1", params![outbox_id])?;
            }
            "keep_mine" => {
                // To keep mine, we must bump the sync_version to match server + 1 (or whatever)
                // Actually, the server's server_row has the current sync_version.
                // We should update our outbox op with the new sync_version from server_row to "win" on next push.
                let server_row: JsonValue = serde_json::from_str(&server_row_json).unwrap_or(JsonValue::Null);
                let server_version = server_row.get("sync_version").and_then(|v| v.as_i64()).unwrap_or(0);
                
                tx.execute(
                    "UPDATE sync_outbox SET sync_version = ?1, attempts = 0, last_error = NULL WHERE id = ?2",
                    params![server_version, outbox_id],
                )?;
            }
            _ => return Err(crate::AppError::Internal("Invalid conflict resolution action".into())),
        }

        tx.execute(
            "UPDATE sync_conflicts SET resolved_at = ?1 WHERE id = ?2",
            params![now, conflict_id],
        )?;

        tx.commit()?;
        Ok(())
    }
}

fn get_table_name(entity_type: &str) -> Option<&'static str> {
    match entity_type {
        "maintenance_categories" => Some("maintenance_categories"),
        "maintenance_templates" => Some("maintenance_templates"),
        "maintenance_records" => Some("maintenance_records"),
        "vehicle_odometer_overrides" => Some("vehicle_odometer_overrides"),
        "chassis_layouts" => Some("chassis_layouts"),
        "chassis_axles" => Some("chassis_axles"),
        "chassis_positions" => Some("chassis_positions"),
        "tires" => Some("tires"),
        "tire_assignments" => Some("tire_assignments"),
        _ => None,
    }
}

fn get_pk_column(entity_type: &str) -> Option<&'static str> {
    match entity_type {
        "vehicle_odometer_overrides" => Some("vehicle_id"),
        _ => Some("id"),
    }
}

fn apply_pulled_row(tx: &rusqlite::Transaction, entity_type: &str, row: &JsonValue) -> AppResult<()> {
    match entity_type {
        "maintenance_categories" => {
            tx.execute(
                "INSERT INTO maintenance_categories (id, name_ar, name_en, icon, color, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                    name_ar = excluded.name_ar,
                    name_en = excluded.name_en,
                    icon = excluded.icon,
                    color = excluded.color,
                    sort_order = excluded.sort_order",
                params![
                    row.get("id").and_then(|v| v.as_str()),
                    row.get("name_ar").and_then(|v| v.as_str()),
                    row.get("name_en").and_then(|v| v.as_str()),
                    row.get("icon").and_then(|v| v.as_str()),
                    row.get("color").and_then(|v| v.as_str()),
                    row.get("sort_order").and_then(|v| v.as_i64()),
                ],
            )?;
        }
        "maintenance_templates" => {
             tx.execute(
                "INSERT INTO maintenance_templates (id, vehicle_id, category_id, name_ar, name_en, notes_ar, notes_en, trigger_type, interval_km, interval_days, lead_warn_km, lead_warn_days, is_active, created_at, updated_at, deleted_at, created_by_user_id, updated_by_user_id, sync_version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
                 ON CONFLICT(id) DO UPDATE SET
                    vehicle_id = excluded.vehicle_id,
                    category_id = excluded.category_id,
                    name_ar = excluded.name_ar,
                    name_en = excluded.name_en,
                    notes_ar = excluded.notes_ar,
                    notes_en = excluded.notes_en,
                    trigger_type = excluded.trigger_type,
                    interval_km = excluded.interval_km,
                    interval_days = excluded.interval_days,
                    lead_warn_km = excluded.lead_warn_km,
                    lead_warn_days = excluded.lead_warn_days,
                    is_active = excluded.is_active,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    created_by_user_id = excluded.created_by_user_id,
                    updated_by_user_id = excluded.updated_by_user_id,
                    sync_version = excluded.sync_version",
                params![
                    row.get("id").and_then(|v| v.as_str()),
                    row.get("vehicle_id").and_then(|v| v.as_i64()),
                    row.get("category_id").and_then(|v| v.as_str()),
                    row.get("name_ar").and_then(|v| v.as_str()),
                    row.get("name_en").and_then(|v| v.as_str()),
                    row.get("notes_ar").and_then(|v| v.as_str()),
                    row.get("notes_en").and_then(|v| v.as_str()),
                    row.get("trigger_type").and_then(|v| v.as_str()),
                    row.get("interval_km").and_then(|v| v.as_i64()),
                    row.get("interval_days").and_then(|v| v.as_i64()),
                    row.get("lead_warn_km").and_then(|v| v.as_i64()),
                    row.get("lead_warn_days").and_then(|v| v.as_i64()),
                    row.get("is_active").and_then(|v| v.as_bool()).map(|b| if b { 1 } else { 0 }),
                    row.get("created_at").and_then(|v| v.as_str()),
                    row.get("updated_at").and_then(|v| v.as_str()),
                    row.get("deleted_at").and_then(|v| v.as_str()),
                    row.get("created_by_user_id").and_then(|v| v.as_i64()),
                    row.get("updated_by_user_id").and_then(|v| v.as_i64()),
                    row.get("sync_version").and_then(|v| v.as_i64()),
                ],
            )?;
        }
        "maintenance_records" => {
            tx.execute(
                "INSERT INTO maintenance_records (id, template_id, vehicle_id, category_id, performed_at, odometer_at_service, next_due_at, next_due_km, cost, vendor, performed_by, notes, attachments, created_at, updated_at, deleted_at, created_by_user_id, updated_by_user_id, sync_version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
                 ON CONFLICT(id) DO UPDATE SET
                    template_id = excluded.template_id,
                    vehicle_id = excluded.vehicle_id,
                    category_id = excluded.category_id,
                    performed_at = excluded.performed_at,
                    odometer_at_service = excluded.odometer_at_service,
                    next_due_at = excluded.next_due_at,
                    next_due_km = excluded.next_due_km,
                    cost = excluded.cost,
                    vendor = excluded.vendor,
                    performed_by = excluded.performed_by,
                    notes = excluded.notes,
                    attachments = excluded.attachments,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    created_by_user_id = excluded.created_by_user_id,
                    updated_by_user_id = excluded.updated_by_user_id,
                    sync_version = excluded.sync_version",
                params![
                    row.get("id").and_then(|v| v.as_str()),
                    row.get("template_id").and_then(|v| v.as_str()),
                    row.get("vehicle_id").and_then(|v| v.as_i64()),
                    row.get("category_id").and_then(|v| v.as_str()),
                    row.get("performed_at").and_then(|v| v.as_str()),
                    row.get("odometer_at_service").and_then(|v| v.as_i64()),
                    row.get("next_due_at").and_then(|v| v.as_str()),
                    row.get("next_due_km").and_then(|v| v.as_i64()),
                    row.get("cost").and_then(|v| v.as_f64()),
                    row.get("vendor").and_then(|v| v.as_str()),
                    row.get("performed_by").and_then(|v| v.as_str()),
                    row.get("notes").and_then(|v| v.as_str()),
                    row.get("attachments").and_then(|v| v.as_str()).unwrap_or("[]"),
                    row.get("created_at").and_then(|v| v.as_str()),
                    row.get("updated_at").and_then(|v| v.as_str()),
                    row.get("deleted_at").and_then(|v| v.as_str()),
                    row.get("created_by_user_id").and_then(|v| v.as_i64()),
                    row.get("updated_by_user_id").and_then(|v| v.as_i64()),
                    row.get("sync_version").and_then(|v| v.as_i64()),
                ],
            )?;
        }
        "vehicle_odometer_overrides" => {
            tx.execute(
                "INSERT INTO vehicle_odometer_overrides (vehicle_id, odometer, set_at, notes, created_at, updated_at, created_by_user_id, updated_by_user_id, sync_version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(vehicle_id) DO UPDATE SET
                    odometer = excluded.odometer,
                    set_at = excluded.set_at,
                    notes = excluded.notes,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    created_by_user_id = excluded.created_by_user_id,
                    updated_by_user_id = excluded.updated_by_user_id,
                    sync_version = excluded.sync_version",
                params![
                    row.get("vehicle_id").and_then(|v| v.as_i64()),
                    row.get("odometer").and_then(|v| v.as_i64()),
                    row.get("set_at").and_then(|v| v.as_str()),
                    row.get("notes").and_then(|v| v.as_str()),
                    row.get("created_at").and_then(|v| v.as_str()),
                    row.get("updated_at").and_then(|v| v.as_str()),
                    row.get("created_by_user_id").and_then(|v| v.as_i64()),
                    row.get("updated_by_user_id").and_then(|v| v.as_i64()),
                    row.get("sync_version").and_then(|v| v.as_i64()),
                ],
            )?;
        }
        "chassis_layouts" => {
            tx.execute(
                "INSERT INTO chassis_layouts (id, vehicle_id, name_ar, name_en, created_at, updated_at, deleted_at, created_by_user_id, updated_by_user_id, sync_version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(id) DO UPDATE SET
                    vehicle_id = excluded.vehicle_id,
                    name_ar = excluded.name_ar,
                    name_en = excluded.name_en,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    created_by_user_id = excluded.created_by_user_id,
                    updated_by_user_id = excluded.updated_by_user_id,
                    sync_version = excluded.sync_version",
                params![
                    row.get("id").and_then(|v| v.as_str()),
                    row.get("vehicle_id").and_then(|v| v.as_i64()),
                    row.get("name_ar").and_then(|v| v.as_str()),
                    row.get("name_en").and_then(|v| v.as_str()),
                    row.get("created_at").and_then(|v| v.as_str()),
                    row.get("updated_at").and_then(|v| v.as_str()),
                    row.get("deleted_at").and_then(|v| v.as_str()),
                    row.get("created_by_user_id").and_then(|v| v.as_i64()),
                    row.get("updated_by_user_id").and_then(|v| v.as_i64()),
                    row.get("sync_version").and_then(|v| v.as_i64()),
                ],
            )?;
        }
        "chassis_axles" => {
            tx.execute(
                "INSERT INTO chassis_axles (id, layout_id, section, section_index, axle_type, label_ar, label_en, is_steering, is_lifted, created_at, updated_at, deleted_at, created_by_user_id, updated_by_user_id, sync_version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
                 ON CONFLICT(id) DO UPDATE SET
                    layout_id = excluded.layout_id,
                    section = excluded.section,
                    section_index = excluded.section_index,
                    axle_type = excluded.axle_type,
                    label_ar = excluded.label_ar,
                    label_en = excluded.label_en,
                    is_steering = excluded.is_steering,
                    is_lifted = excluded.is_lifted,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    created_by_user_id = excluded.created_by_user_id,
                    updated_by_user_id = excluded.updated_by_user_id,
                    sync_version = excluded.sync_version",
                params![
                    row.get("id").and_then(|v| v.as_str()),
                    row.get("layout_id").and_then(|v| v.as_str()),
                    row.get("section").and_then(|v| v.as_str()),
                    row.get("section_index").and_then(|v| v.as_i64()),
                    row.get("axle_type").and_then(|v| v.as_str()),
                    row.get("label_ar").and_then(|v| v.as_str()),
                    row.get("label_en").and_then(|v| v.as_str()),
                    row.get("is_steering").and_then(|v| v.as_bool()).map(|b| if b { 1 } else { 0 }),
                    row.get("is_lifted").and_then(|v| v.as_bool()).map(|b| if b { 1 } else { 0 }),
                    row.get("created_at").and_then(|v| v.as_str()),
                    row.get("updated_at").and_then(|v| v.as_str()),
                    row.get("deleted_at").and_then(|v| v.as_str()),
                    row.get("created_by_user_id").and_then(|v| v.as_i64()),
                    row.get("updated_by_user_id").and_then(|v| v.as_i64()),
                    row.get("sync_version").and_then(|v| v.as_i64()),
                ],
            )?;
        }
        "chassis_positions" => {
            tx.execute(
                "INSERT INTO chassis_positions (id, layout_id, axle_id, side, depth, is_spare, spare_index, position_code, created_at, updated_at, deleted_at, created_by_user_id, updated_by_user_id, sync_version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                 ON CONFLICT(id) DO UPDATE SET
                    layout_id = excluded.layout_id,
                    axle_id = excluded.axle_id,
                    side = excluded.side,
                    depth = excluded.depth,
                    is_spare = excluded.is_spare,
                    spare_index = excluded.spare_index,
                    position_code = excluded.position_code,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    created_by_user_id = excluded.created_by_user_id,
                    updated_by_user_id = excluded.updated_by_user_id,
                    sync_version = excluded.sync_version",
                params![
                    row.get("id").and_then(|v| v.as_str()),
                    row.get("layout_id").and_then(|v| v.as_str()),
                    row.get("axle_id").and_then(|v| v.as_str()),
                    row.get("side").and_then(|v| v.as_str()),
                    row.get("depth").and_then(|v| v.as_str()),
                    row.get("is_spare").and_then(|v| v.as_bool()).map(|b| if b { 1 } else { 0 }),
                    row.get("spare_index").and_then(|v| v.as_i64()),
                    row.get("position_code").and_then(|v| v.as_str()),
                    row.get("created_at").and_then(|v| v.as_str()),
                    row.get("updated_at").and_then(|v| v.as_str()),
                    row.get("deleted_at").and_then(|v| v.as_str()),
                    row.get("created_by_user_id").and_then(|v| v.as_i64()),
                    row.get("updated_by_user_id").and_then(|v| v.as_i64()),
                    row.get("sync_version").and_then(|v| v.as_i64()),
                ],
            )?;
        }
        "tires" => {
            tx.execute(
                "INSERT INTO tires (id, dot_code, internal_serial, brand, model, purchase_date, purchase_cost, supplier, production_week, production_year, production_date, is_retread, retread_count, parent_tire_id, status, stock_location, scrap_reason, scrap_date, notes, created_at, updated_at, deleted_at, created_by_user_id, updated_by_user_id, sync_version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)
                 ON CONFLICT(id) DO UPDATE SET
                    dot_code = excluded.dot_code,
                    internal_serial = excluded.internal_serial,
                    brand = excluded.brand,
                    model = excluded.model,
                    purchase_date = excluded.purchase_date,
                    purchase_cost = excluded.purchase_cost,
                    supplier = excluded.supplier,
                    production_week = excluded.production_week,
                    production_year = excluded.production_year,
                    production_date = excluded.production_date,
                    is_retread = excluded.is_retread,
                    retread_count = excluded.retread_count,
                    parent_tire_id = excluded.parent_tire_id,
                    status = excluded.status,
                    stock_location = excluded.stock_location,
                    scrap_reason = excluded.scrap_reason,
                    scrap_date = excluded.scrap_date,
                    notes = excluded.notes,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    created_by_user_id = excluded.created_by_user_id,
                    updated_by_user_id = excluded.updated_by_user_id,
                    sync_version = excluded.sync_version",
                params![
                    row.get("id").and_then(|v| v.as_str()),
                    row.get("dot_code").and_then(|v| v.as_str()),
                    row.get("internal_serial").and_then(|v| v.as_str()),
                    row.get("brand").and_then(|v| v.as_str()),
                    row.get("model").and_then(|v| v.as_str()),
                    row.get("purchase_date").and_then(|v| v.as_str()),
                    row.get("purchase_cost").and_then(|v| v.as_f64()),
                    row.get("supplier").and_then(|v| v.as_str()),
                    row.get("production_week").and_then(|v| v.as_i64()),
                    row.get("production_year").and_then(|v| v.as_i64()),
                    row.get("production_date").and_then(|v| v.as_str()),
                    row.get("is_retread").and_then(|v| v.as_bool()).map(|b| if b { 1 } else { 0 }),
                    row.get("retread_count").and_then(|v| v.as_i64()),
                    row.get("parent_tire_id").and_then(|v| v.as_str()),
                    row.get("status").and_then(|v| v.as_str()),
                    row.get("stock_location").and_then(|v| v.as_str()),
                    row.get("scrap_reason").and_then(|v| v.as_str()),
                    row.get("scrap_date").and_then(|v| v.as_str()),
                    row.get("notes").and_then(|v| v.as_str()),
                    row.get("created_at").and_then(|v| v.as_str()),
                    row.get("updated_at").and_then(|v| v.as_str()),
                    row.get("deleted_at").and_then(|v| v.as_str()),
                    row.get("created_by_user_id").and_then(|v| v.as_i64()),
                    row.get("updated_by_user_id").and_then(|v| v.as_i64()),
                    row.get("sync_version").and_then(|v| v.as_i64()),
                ],
            )?;
        }
        "tire_assignments" => {
            tx.execute(
                "INSERT INTO tire_assignments (id, tire_id, position_id, vehicle_id, mounted_at, mounted_odometer, dismounted_at, dismounted_odometer, mount_reason, dismount_reason, notes, created_at, updated_at, deleted_at, created_by_user_id, updated_by_user_id, sync_version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
                 ON CONFLICT(id) DO UPDATE SET
                    tire_id = excluded.tire_id,
                    position_id = excluded.position_id,
                    vehicle_id = excluded.vehicle_id,
                    mounted_at = excluded.mounted_at,
                    mounted_odometer = excluded.mounted_odometer,
                    dismounted_at = excluded.dismounted_at,
                    dismounted_odometer = excluded.dismounted_odometer,
                    mount_reason = excluded.mount_reason,
                    dismount_reason = excluded.dismount_reason,
                    notes = excluded.notes,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    created_by_user_id = excluded.created_by_user_id,
                    updated_by_user_id = excluded.updated_by_user_id,
                    sync_version = excluded.sync_version",
                params![
                    row.get("id").and_then(|v| v.as_str()),
                    row.get("tire_id").and_then(|v| v.as_str()),
                    row.get("position_id").and_then(|v| v.as_str()),
                    row.get("vehicle_id").and_then(|v| v.as_i64()),
                    row.get("mounted_at").and_then(|v| v.as_str()),
                    row.get("mounted_odometer").and_then(|v| v.as_i64()),
                    row.get("dismounted_at").and_then(|v| v.as_str()),
                    row.get("dismounted_odometer").and_then(|v| v.as_i64()),
                    row.get("mount_reason").and_then(|v| v.as_str()),
                    row.get("dismount_reason").and_then(|v| v.as_str()),
                    row.get("notes").and_then(|v| v.as_str()),
                    row.get("created_at").and_then(|v| v.as_str()),
                    row.get("updated_at").and_then(|v| v.as_str()),
                    row.get("deleted_at").and_then(|v| v.as_str()),
                    row.get("created_by_user_id").and_then(|v| v.as_i64()),
                    row.get("updated_by_user_id").and_then(|v| v.as_i64()),
                    row.get("sync_version").and_then(|v| v.as_i64()),
                ],
            )?;
        }
        _ => {}
    }
    Ok(())
}
