//! The one client-side registry of entity schema knowledge.
//!
//! Everything that used to be scattered per-entity lists — the engine's
//! column tables, the domain layer's pk rule and boolean-column lists, the
//! sync order — lives here, so the queue and transport code stays
//! domain-blind and adding a column is ONE edit (plus the server's
//! writable_columns/pg_cast pair, which this table mirrors).
//!
//! `schema_registry_matches_wire_vocabulary` pins the entity strings and the
//! dependency order; the codegen/live tests catch column drift.

pub struct EntityMeta {
    pub entity: &'static str,
    pub pk: &'static str,
    /// Full local column set (local DDL order-independent; used to build
    /// pull-apply upserts and outbox row snapshots).
    pub columns: &'static [&'static str],
    /// Columns that are boolean on the wire but 0/1 integers in SQLite.
    pub bool_cols: &'static [&'static str],
    /// Payload keys that reference a PARENT entity's id — the dependency
    /// gating uses these to hold a child back while its parent is dead.
    pub fk_cols: &'static [&'static str],
}

/// Owned entities, in dependency order: parents sync before the rows that
/// reference them so a fresh pull never trips a foreign key.
pub const ENTITIES: &[EntityMeta] = &[
    EntityMeta {
        entity: "chassis_layouts",
        pk: "id",
        columns: &[
            "id", "vehicle_id", "name_ar", "name_en", "created_at", "updated_at", "deleted_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        bool_cols: &[],
        fk_cols: &[],
    },
    EntityMeta {
        entity: "chassis_axles",
        pk: "id",
        columns: &[
            "id", "layout_id", "section", "section_index", "axle_type", "label_ar", "label_en",
            "is_steering", "is_lifted", "created_at", "updated_at", "deleted_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        bool_cols: &["is_steering", "is_lifted"],
        fk_cols: &["layout_id"],
    },
    EntityMeta {
        entity: "chassis_positions",
        pk: "id",
        columns: &[
            "id", "layout_id", "axle_id", "side", "depth", "is_spare", "spare_index",
            "position_code", "created_at", "updated_at", "deleted_at", "created_by_user_id",
            "updated_by_user_id", "sync_version",
        ],
        bool_cols: &["is_spare"],
        fk_cols: &["layout_id", "axle_id"],
    },
    EntityMeta {
        entity: "work_orders",
        pk: "id",
        columns: &[
            "id", "vehicle_id", "status", "title", "odometer_at_open", "opened_at", "closed_at",
            "notes_ar", "notes_en", "created_at", "updated_at", "deleted_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        bool_cols: &[],
        fk_cols: &[],
    },
    EntityMeta {
        entity: "work_order_tasks",
        pk: "id",
        columns: &[
            "id", "work_order_id", "kind", "category_id", "description_ar", "description_en",
            "is_done", "sort_order", "created_at", "updated_at", "deleted_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        bool_cols: &["is_done"],
        fk_cols: &["work_order_id"],
    },
    EntityMeta {
        entity: "oil_changes",
        pk: "id",
        columns: &[
            "id", "work_order_id", "vehicle_id", "oil_type", "liters", "odometer", "flagged",
            "notes", "performed_at", "created_at", "updated_at", "deleted_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        bool_cols: &["flagged"],
        fk_cols: &["work_order_id"],
    },
    EntityMeta {
        entity: "vehicle_class_assignments",
        pk: "vehicle_id",
        columns: &[
            "vehicle_id", "class_id", "created_at", "updated_at", "deleted_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        bool_cols: &[],
        fk_cols: &[],
    },
    EntityMeta {
        entity: "vehicle_odometer_overrides",
        pk: "vehicle_id",
        columns: &[
            "vehicle_id", "odometer", "set_at", "notes", "superseded_km", "created_at",
            "updated_at", "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        bool_cols: &[],
        fk_cols: &[],
    },
    EntityMeta {
        entity: "tires",
        pk: "id",
        columns: &[
            "id", "dot_code", "brand", "model", "size", "status", "origin", "total_km",
            "parent_tire_id", "retread_count", "notes_ar", "notes_en",
            "created_at", "updated_at", "deleted_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        bool_cols: &[],
        fk_cols: &["parent_tire_id"],
    },
    EntityMeta {
        entity: "tire_assignments",
        pk: "id",
        columns: &[
            "id", "tire_id", "position_id", "vehicle_id", "work_order_id", "mounted_at",
            "mounted_odometer", "mount_reason", "dismounted_at", "dismounted_odometer",
            "dismount_reason", "dismount_work_order_id", "notes",
            "created_at", "updated_at", "deleted_at", "created_by_user_id", "updated_by_user_id",
            "sync_version",
        ],
        bool_cols: &[],
        fk_cols: &["tire_id", "position_id", "work_order_id", "dismount_work_order_id"],
    },
    EntityMeta {
        entity: "tire_status_events",
        pk: "id",
        columns: &[
            "id", "tire_id", "event_type", "work_order_id", "from_status", "to_status",
            "notes", "occurred_at", "created_at", "updated_at", "deleted_at",
            "created_by_user_id", "updated_by_user_id", "sync_version",
        ],
        bool_cols: &[],
        fk_cols: &["tire_id", "work_order_id"],
    },
];

pub fn meta(entity: &str) -> Option<&'static EntityMeta> {
    ENTITIES.iter().find(|m| m.entity == entity)
}

pub fn pk_for(entity: &str) -> &'static str {
    meta(entity).map(|m| m.pk).unwrap_or("id")
}

pub fn columns_for(entity: &str) -> &'static [&'static str] {
    meta(entity).map(|m| m.columns).unwrap_or(&[])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pins the wire vocabulary: renaming an entity on either side must fail a
    /// test, not a live sync. (The server's serde enum owns the other half.)
    #[test]
    fn schema_registry_matches_wire_vocabulary() {
        let names: Vec<&str> = ENTITIES.iter().map(|m| m.entity).collect();
        assert_eq!(
            names,
            vec![
                "chassis_layouts",
                "chassis_axles",
                "chassis_positions",
                "work_orders",
                "work_order_tasks",
                "oil_changes",
                "vehicle_class_assignments",
                "vehicle_odometer_overrides",
                "tires",
                "tire_assignments",
                "tire_status_events",
            ]
        );
    }

    /// The order IS the dependency order: every fk_col another entity declares
    /// must resolve to an entity that appears EARLIER in the list (or to a
    /// column of an earlier entity), so pulls never trip a foreign key.
    #[test]
    fn dependency_order_puts_parents_first() {
        // payload key → the entity it references
        let target = |fk: &str| -> &'static str {
            match fk {
                "layout_id" => "chassis_layouts",
                "axle_id" => "chassis_axles",
                "position_id" => "chassis_positions",
                "work_order_id" | "dismount_work_order_id" => "work_orders",
                "tire_id" | "parent_tire_id" => "tires",
                other => panic!("unmapped fk col {other}"),
            }
        };
        let index_of = |e: &str| ENTITIES.iter().position(|m| m.entity == e).unwrap();
        for m in ENTITIES {
            for fk in m.fk_cols {
                let parent = target(fk);
                if parent == m.entity {
                    continue; // self-reference (parent_tire_id)
                }
                assert!(
                    index_of(parent) < index_of(m.entity),
                    "{} must sync before {} (fk {})",
                    parent,
                    m.entity,
                    fk
                );
            }
        }
    }

    /// Every bool/fk column must be a member of the entity's own column list.
    #[test]
    fn meta_lists_are_internally_consistent() {
        for m in ENTITIES {
            for c in m.bool_cols {
                assert!(m.columns.contains(c), "{}: bool col {c} not in columns", m.entity);
            }
            for c in m.fk_cols {
                assert!(m.columns.contains(c), "{}: fk col {c} not in columns", m.entity);
            }
            assert!(m.columns.contains(&m.pk), "{}: pk not in columns", m.entity);
        }
    }
}
