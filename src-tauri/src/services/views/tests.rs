
    use super::*;
    use crate::db::DbPool;
    use crate::services::domain::{
        self, ChassisConfig, DismountInput, MountFromStockInput, MountUsedInput,
    };
    use rusqlite::params;

    fn pool() -> DbPool {
        let dir = std::env::temp_dir().join(format!("apex-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = DbPool::open(&dir.join("t.db")).unwrap();
        p.run_migrations().unwrap();
        p
    }

    fn seed_vehicle(pool: &DbPool, id: i64, plate: &str, fuel: i64) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO vehicles_cache (id, car_no_plate, last_fuel_odometer, raw_payload, fetched_at)
             VALUES (?1, ?2, ?3, '{}', ?4)",
            params![id, plate, fuel, domain::now_iso()],
        )
        .unwrap();
    }

    fn seed_stock(pool: &DbPool) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO tire_stock_cache (id, brand, model, size, on_hand_qty, fetched_at)
             VALUES ('s1', 'Pirelli', 'FR01', '315/80R22.5', 5, ?1)",
            params![domain::now_iso()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO oil_stock_cache (id, oil_type, liters_on_hand, fetched_at)
             VALUES ('o1', '15W-40', 200.0, ?1)",
            params![domain::now_iso()],
        )
        .unwrap();
    }

    fn seed_plan(pool: &DbPool, class_id: &str, category: &str, interval_km: i64) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO vehicle_classes (id, name_ar, name_en, sort_order) VALUES (?1, ?1, ?1, 1)
             ON CONFLICT(id) DO NOTHING",
            params![class_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO service_plans (id, class_id, category_id, trigger_type, interval_km,
                                        lead_warn_km, lead_warn_days, is_active)
             VALUES (?1, ?2, ?3, 'mileage', ?4, 500, 14, 1)",
            params![uuid::Uuid::new_v4().to_string(), class_id, category, interval_km],
        )
        .unwrap();
    }

    #[test]
    fn chassis_generates_28_positions_with_codes() {
        let p = pool();
        seed_vehicle(&p, 1, "ف ل ص 8351", 100_000);
        domain::chassis_create(
            &p,
            1,
            &ChassisConfig { drive_axles: 2, trailer_axles: 4, spares: 2, single_trailer_axles: None },
            9,
        )
        .unwrap();
        let ch = chassis_get(&p, 1).unwrap().expect("chassis");
        assert_eq!(ch.positions.len(), 28);
        assert_eq!(ch.axles.len(), 7);
        let codes: Vec<&str> = ch.positions.iter().map(|x| x.position_code.as_str()).collect();
        for c in ["H1L", "H1R", "H2LO", "H3RI", "TR4RO", "SP1", "SP2"] {
            assert!(codes.contains(&c), "missing {c}");
        }
        assert!(ch.positions.iter().all(|x| x.tire_id.is_none()), "fresh chassis is empty");
    }

    #[test]
    fn mount_from_stock_projects_stock_and_guards_the_position() {
        let p = pool();
        seed_vehicle(&p, 2, "ف د ى 6738", 200_000);
        seed_stock(&p);
        domain::chassis_create(
            &p,
            2,
            &ChassisConfig { drive_axles: 2, trailer_axles: 3, spares: 1, single_trailer_axles: None },
            9,
        )
        .unwrap();
        let wo = domain::wo_open(&p, 2, Some(200_000), 9).unwrap();
        let ch = chassis_get(&p, 2).unwrap().unwrap();
        let pos = ch.positions.iter().find(|x| x.position_code == "H2LO").unwrap().id.clone();

        let (tire_id, _) = domain::mount_from_stock(
            &p,
            &MountFromStockInput {
                position_id: pos.clone(),
                vehicle_id: 2,
                work_order_id: wo.clone(),
                brand: "Pirelli".into(),
                model: Some("FR01".into()),
                size: Some("315/80R22.5".into()),
                dot_code: Some("DOT-1234".into()),
                odometer: Some(200_000),
            },
            9,
        )
        .unwrap();

        // Projection: snapshot 5, one queued shipment tire ⇒ projected 4.
        let sv = stock_view(&p).unwrap();
        assert_eq!(sv.tires[0].snapshot_qty, 5);
        assert_eq!(sv.tires[0].pending_debits, 1);
        assert_eq!(sv.tires[0].projected_qty, 4);

        // The diagram sees the mount, flagged as still-queued.
        let ch = chassis_get(&p, 2).unwrap().unwrap();
        let mounted = ch.positions.iter().find(|x| x.position_code == "H2LO").unwrap();
        assert_eq!(mounted.tire_id.as_deref(), Some(tire_id.as_str()));
        assert!(mounted.pending, "unacked mount is visibly queued");

        // Same position again must refuse locally (mirror of uq_active_position).
        let again = domain::mount_from_stock(
            &p,
            &MountFromStockInput {
                position_id: pos,
                vehicle_id: 2,
                work_order_id: wo,
                brand: "Pirelli".into(),
                model: None,
                size: None,
                dot_code: None,
                odometer: None,
            },
            9,
        );
        assert!(again.is_err(), "occupied position must reject a second mount");
    }

    #[test]
    fn dismount_derives_status_and_km_and_pool_tires_remount() {
        let p = pool();
        seed_vehicle(&p, 3, "ف ق ص 4253", 300_000);
        seed_stock(&p);
        domain::chassis_create(
            &p,
            3,
            &ChassisConfig { drive_axles: 1, trailer_axles: 2, spares: 1, single_trailer_axles: None },
            9,
        )
        .unwrap();
        let wo = domain::wo_open(&p, 3, Some(300_000), 9).unwrap();
        let ch = chassis_get(&p, 3).unwrap().unwrap();
        let pos_a = ch.positions.iter().find(|x| x.position_code == "H2LO").unwrap().id.clone();
        let pos_b = ch.positions.iter().find(|x| x.position_code == "H2LI").unwrap().id.clone();

        let (tire_id, asg) = domain::mount_from_stock(
            &p,
            &MountFromStockInput {
                position_id: pos_a,
                vehicle_id: 3,
                work_order_id: wo.clone(),
                brand: "Pirelli".into(),
                model: Some("FR01".into()),
                size: Some("315/80R22.5".into()),
                dot_code: None,
                odometer: Some(300_000),
            },
            9,
        )
        .unwrap();

        // Rotation dismount → back to the used pool with km accrued.
        domain::dismount(
            &p,
            &DismountInput {
                assignment_id: asg,
                odometer: Some(320_000),
                reason: "rotation".into(),
                work_order_id: Some(wo.clone()),
            },
            9,
        )
        .unwrap();
        let t = tire_file(&p, &tire_id).unwrap().unwrap();
        assert_eq!(t.tire.status, "in_stock_used");
        assert_eq!(t.tire.total_km, 20_000);
        assert_eq!(t.mounts.len(), 1);

        // The pool tire mounts again (used flow), then a worn dismount scraps it.
        let asg2 = domain::mount_used(
            &p,
            &MountUsedInput {
                tire_id: tire_id.clone(),
                position_id: pos_b,
                vehicle_id: 3,
                work_order_id: wo,
                odometer: Some(320_000),
                reason: "rotation".into(),
            },
            9,
        )
        .unwrap();
        // The dismount happens under a DIFFERENT work order than the mount —
        // it must show up in that WO's tire work (dismount_work_order_id).
        let wo2 = domain::wo_open(&p, 3, Some(345_000), 9).unwrap();
        domain::dismount(
            &p,
            &DismountInput {
                assignment_id: asg2,
                odometer: Some(345_000),
                reason: "worn".into(),
                work_order_id: Some(wo2.clone()),
            },
            9,
        )
        .unwrap();
        let d2 = wo_detail(&p, &wo2).unwrap().unwrap();
        assert_eq!(d2.tire_ops.len(), 1, "dismount is attributed to the WO it happened under");
        assert!(d2.tire_ops[0].dismounted_at.is_some());
        let t = tire_file(&p, &tire_id).unwrap().unwrap();
        assert_eq!(t.tire.status, "scrapped", "worn → scrapped, same rule as the server");
        assert_eq!(t.tire.total_km, 45_000, "km accrues across mounts");
    }

    #[test]
    fn plans_due_flow_with_oil_flag_and_override() {
        let p = pool();
        seed_vehicle(&p, 4, "ف ر س 4593", 100_000);
        seed_stock(&p);
        seed_plan(&p, "tractor", "oil_change", 10_000);
        domain::class_assign(&p, 4, "tractor", 9).unwrap();

        // Never done yet.
        let due = due_board(&p, Some(4)).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].status, "never_done");

        // A work order with an oil change resets the clock.
        let wo = domain::wo_open(&p, 4, Some(105_000), 9).unwrap();
        let (_, flagged) = domain::oil_add(&p, &wo, 4, "15W-40", 40.0, Some(105_100), 9).unwrap();
        assert!(flagged, "40 L flags");
        let due = due_board(&p, Some(4)).unwrap();
        assert_eq!(due[0].status, "ok");
        assert_eq!(due[0].next_due_km, Some(115_000));
        assert_eq!(due[0].current_odometer, Some(105_100), "oil odometer beats the fuel reading");

        // A manual override pushes it overdue.
        domain::override_set(&p, 4, 116_000, None, 9).unwrap();
        let due = due_board(&p, Some(4)).unwrap();
        assert_eq!(due[0].status, "overdue");
        assert_eq!(due[0].odometer_source.as_deref(), Some("manual_override"));
    }

    #[test]
    fn editing_history_odometers_repropagates_km() {
        let p = pool();
        seed_vehicle(&p, 9, "ف ع ص 4381", 400_000);
        seed_stock(&p);
        domain::chassis_create(
            &p,
            9,
            &ChassisConfig { drive_axles: 1, trailer_axles: 0, spares: 0, single_trailer_axles: None },
            9,
        )
        .unwrap();
        let wo = domain::wo_open(&p, 9, Some(400_000), 9).unwrap();
        let ch = chassis_get(&p, 9).unwrap().unwrap();
        let pos = ch.positions.iter().find(|x| x.position_code == "H2LO").unwrap().id.clone();
        let (tire_id, asg) = domain::mount_from_stock(
            &p,
            &MountFromStockInput {
                position_id: pos,
                vehicle_id: 9,
                work_order_id: wo.clone(),
                brand: "Pirelli".into(),
                model: Some("FR01".into()),
                size: Some("315/80R22.5".into()),
                dot_code: None,
                odometer: Some(400_000),
            },
            9,
        )
        .unwrap();
        domain::dismount(
            &p,
            &DismountInput {
                assignment_id: asg.clone(),
                odometer: Some(430_000),
                reason: "rotation".into(),
                work_order_id: Some(wo),
            },
            9,
        )
        .unwrap();
        assert_eq!(tire_file(&p, &tire_id).unwrap().unwrap().tire.total_km, 30_000);

        // The dismount odometer was mistyped — correct it. km repropagates.
        domain::assignment_set_odometers(&p, &asg, None, Some(410_000), 9).unwrap();
        assert_eq!(
            tire_file(&p, &tire_id).unwrap().unwrap().tire.total_km,
            10_000,
            "derived km follows the corrected history"
        );

        // Nonsense edits are rejected.
        assert!(domain::assignment_set_odometers(&p, &asg, Some(420_000), None, 9).is_err());
    }

    #[test]
    fn override_corrects_downward_and_later_readings_resume() {
        let p = pool();
        // Falcon reports an inflated 500k. The mechanic corrects DOWN to 300k.
        seed_vehicle(&p, 7, "ف ج م 8567", 500_000);
        domain::override_set(&p, 7, 300_000, Some("قراءة التابلوه"), 9).unwrap();
        let o = odometer_truth(&p, 7).unwrap().unwrap();
        assert_eq!(o.km, 300_000, "the correction wins over the inflated reading");
        assert_eq!(o.source, "manual_override");

        // A reading recorded AFTER the correction resumes normal MAX rules.
        let _wo = domain::wo_open(&p, 7, Some(305_000), 9).unwrap();
        let o = odometer_truth(&p, 7).unwrap().unwrap();
        assert_eq!(o.km, 305_000);
        assert_eq!(o.source, "work_order");
    }

    #[test]
    fn mounted_tire_km_is_live_with_the_odometer() {
        let p = pool();
        seed_vehicle(&p, 8, "ف ل ص 4317", 300_000);
        seed_stock(&p);
        domain::chassis_create(
            &p,
            8,
            &ChassisConfig { drive_axles: 1, trailer_axles: 0, spares: 0, single_trailer_axles: None },
            9,
        )
        .unwrap();
        let wo = domain::wo_open(&p, 8, Some(300_000), 9).unwrap();
        let ch = chassis_get(&p, 8).unwrap().unwrap();
        let pos = ch.positions.iter().find(|x| x.position_code == "H2LO").unwrap().id.clone();
        let (tire_id, _) = domain::mount_from_stock(
            &p,
            &MountFromStockInput {
                position_id: pos,
                vehicle_id: 8,
                work_order_id: wo,
                brand: "Pirelli".into(),
                model: Some("FR01".into()),
                size: Some("315/80R22.5".into()),
                dot_code: None,
                odometer: Some(300_000),
            },
            9,
        )
        .unwrap();

        // Freshly mounted: no run yet.
        let t = tire_file(&p, &tire_id).unwrap().unwrap();
        assert_eq!(t.tire.total_km, 0);

        // Correcting the odometer moves the mounted tire's km immediately.
        domain::override_set(&p, 8, 320_000, None, 9).unwrap();
        let t = tire_file(&p, &tire_id).unwrap().unwrap();
        assert_eq!(t.tire.total_km, 20_000, "mounted km is live, not dismount-only");
        let ch = chassis_get(&p, 8).unwrap().unwrap();
        let w = ch.positions.iter().find(|x| x.tire_id.as_deref() == Some(tire_id.as_str())).unwrap();
        assert_eq!(w.total_km, Some(20_000), "diagram shows the same live km");
    }

    #[test]
    fn search_normalizes_arabic_indic_digits() {
        let p = pool();
        seed_vehicle(&p, 5, "ف ل ص 8351", 0);
        let r = search_all(&p, "٨٣٥١").unwrap();
        assert_eq!(r.trucks.len(), 1, "٨٣٥١ finds plate 8351");
        let r = search_all(&p, "8351").unwrap();
        assert_eq!(r.trucks.len(), 1);
    }

    #[test]
    fn home_summary_shows_open_wos_and_honest_queue() {
        let p = pool();
        seed_vehicle(&p, 6, "ف ى ر 8427", 50_000);
        seed_stock(&p);
        let _wo = domain::wo_open(&p, 6, Some(50_000), 9).unwrap();
        let h = home_summary(&p).unwrap();
        assert_eq!(h.open_wos.len(), 1);
        assert_eq!(h.open_wos[0].plate, "ف ى ر 8427");
        assert!(h.open_wos[0].pending, "unacked WO is marked pending");
        assert!(h.sync_pending >= 1, "queue is honest");
    }

    // ── 2026-07-23 review regressions ────────────────────────────────────────

    /// tire_set_status must enqueue ONLY the event — the server derives
    /// tires.status from it. A queued `tires` update carried a base
    /// sync_version made stale by every assignment side effect, guaranteeing
    /// an offline dismount→restock day dead-lettered the restock.
    #[test]
    fn tire_set_status_enqueues_only_the_event() {
        let p = pool();
        seed_vehicle(&p, 41, "ن م ر 100", 100_000);
        let tires = domain::intake_legacy(
            &p,
            &[domain::LegacyTireInput {
                brand: "GT".into(),
                model: None,
                size: None,
                dot_code: None,
                estimated_km: Some(1_000),
            }],
            9,
        )
        .unwrap();
        let tire_id = tires[0].clone();
        {
            // Flush the intake's outbox rows so the assertion below sees only
            // what tire_set_status itself enqueues.
            let conn = p.get().unwrap();
            conn.execute("UPDATE outbox SET status = 'acked', synced_at = 1", []).unwrap();
        }

        domain::tire_set_status(&p, &tire_id, "retreading", "retread", None, 9).unwrap();

        let conn = p.get().unwrap();
        let queued: Vec<(String, String)> = conn
            .prepare(
                "SELECT entity_type, op FROM outbox WHERE status = 'pending' ORDER BY seq",
            )
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            queued,
            vec![("tire_status_events".to_string(), "insert".to_string())],
            "no competing tires update may be enqueued"
        );
        // The local projection still applied.
        let status: String = conn
            .query_row("SELECT status FROM tires WHERE id = ?1", params![tire_id], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "retreading");
    }

    /// Reasons are validated against the server's Postgres enums BEFORE the
    /// local write — an invalid string used to mount locally and then
    /// dead-letter on the server's enum cast.
    #[test]
    fn invalid_reasons_are_rejected_before_any_write() {
        let p = pool();
        seed_vehicle(&p, 42, "ن م ر 200", 100_000);
        seed_stock(&p);
        domain::chassis_create(
            &p,
            42,
            &ChassisConfig { drive_axles: 1, trailer_axles: 2, spares: 0, single_trailer_axles: None },
            9,
        )
        .unwrap();
        let wo = domain::wo_open(&p, 42, Some(100_000), 9).unwrap();
        let ch = chassis_get(&p, 42).unwrap().unwrap();
        let pos = ch.positions.iter().find(|x| !x.is_spare).unwrap().id.clone();
        let (tire_id, asg) = domain::mount_from_stock(
            &p,
            &MountFromStockInput {
                position_id: pos,
                vehicle_id: 42,
                work_order_id: wo.clone(),
                brand: "Pirelli".into(),
                model: Some("FR01".into()),
                size: Some("315/80R22.5".into()),
                dot_code: None,
                odometer: Some(100_000),
            },
            9,
        )
        .unwrap();

        let bad = domain::dismount(
            &p,
            &DismountInput {
                assignment_id: asg.clone(),
                odometer: Some(110_000),
                reason: "exploded".into(),
                work_order_id: Some(wo),
            },
            9,
        );
        assert!(bad.is_err(), "unknown dismount reason must be rejected");
        // Nothing changed: the assignment is still open, the tire mounted.
        let t = tire_file(&p, &tire_id).unwrap().unwrap();
        assert_eq!(t.tire.status, "mounted");
    }

    /// requeue_dead rebases the op onto the local row's current sync_version —
    /// a conflict dead letter already applied the server row locally, so
    /// re-pushing the old base conflicted again forever.
    #[test]
    fn requeue_dead_rebases_onto_the_local_row_version() {
        let p = pool();
        seed_vehicle(&p, 43, "ن م ر 300", 100_000);
        let tires = domain::intake_legacy(
            &p,
            &[domain::LegacyTireInput {
                brand: "GT".into(),
                model: None,
                size: None,
                dot_code: None,
                estimated_km: None,
            }],
            9,
        )
        .unwrap();
        let tire_id = tires[0].clone();
        let conn = p.get().unwrap();
        // Simulate: the op died as a conflict, and the conflict's server row
        // (sync_version 7) was applied to the local table.
        let seq: i64 = conn
            .query_row("SELECT seq FROM outbox WHERE entity_id = ?1", params![tire_id], |r| r.get(0))
            .unwrap();
        conn.execute(
            "UPDATE outbox SET status = 'dead', op = 'update', last_error = 'conflict' WHERE seq = ?1",
            params![seq],
        )
        .unwrap();
        conn.execute("UPDATE tires SET sync_version = 7 WHERE id = ?1", params![tire_id]).unwrap();

        crate::services::outbox::requeue_dead(&conn, seq).unwrap();
        let (status, base): (String, i64) = conn
            .query_row(
                "SELECT status, base_sync_version FROM outbox WHERE seq = ?1",
                params![seq],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "pending");
        assert_eq!(base, 7, "retry must carry the CURRENT local version, not the stale base");
    }

    /// Stock projection debits count only queued INSERTS — a status update
    /// queued for a long-acked shipment tire is not a stock debit.
    #[test]
    fn stock_projection_ignores_non_insert_outbox_rows() {
        let p = pool();
        seed_vehicle(&p, 44, "ن م ر 400", 100_000);
        seed_stock(&p);
        domain::chassis_create(
            &p,
            44,
            &ChassisConfig { drive_axles: 1, trailer_axles: 2, spares: 0, single_trailer_axles: None },
            9,
        )
        .unwrap();
        let wo = domain::wo_open(&p, 44, Some(100_000), 9).unwrap();
        let ch = chassis_get(&p, 44).unwrap().unwrap();
        let pos = ch.positions.iter().find(|x| !x.is_spare).unwrap().id.clone();
        let (tire_id, asg) = domain::mount_from_stock(
            &p,
            &MountFromStockInput {
                position_id: pos,
                vehicle_id: 44,
                work_order_id: wo.clone(),
                brand: "Pirelli".into(),
                model: Some("FR01".into()),
                size: Some("315/80R22.5".into()),
                dot_code: None,
                odometer: Some(100_000),
            },
            9,
        )
        .unwrap();
        // The shipment insert is queued: projected = 5 − 1.
        assert_eq!(stock_view(&p).unwrap().tires[0].projected_qty, 4);

        // Everything acks (server snapshot now includes the debit: 4 on hand).
        {
            let conn = p.get().unwrap();
            conn.execute("UPDATE outbox SET status = 'acked', synced_at = 1", []).unwrap();
            conn.execute("UPDATE tire_stock_cache SET on_hand_qty = 4 WHERE id = 's1'", []).unwrap();
        }
        assert_eq!(stock_view(&p).unwrap().tires[0].projected_qty, 4);

        // A later dismount (queued update on the SAME shipment tire) must NOT
        // debit stock again.
        domain::dismount(
            &p,
            &DismountInput {
                assignment_id: asg,
                odometer: Some(120_000),
                reason: "worn".into(),
                work_order_id: Some(wo),
            },
            9,
        )
        .unwrap();
        let _ = tire_id;
        assert_eq!(
            stock_view(&p).unwrap().tires[0].projected_qty,
            4,
            "a queued update is not a debit"
        );
    }

    /// The client's oil band mirrors the server constants exactly.
    #[test]
    fn oil_band_matches_the_server_rule() {
        assert!(domain::oil_flagged(33.9));
        assert!(!domain::oil_flagged(34.0));
        assert!(!domain::oil_flagged(36.0));
        assert!(domain::oil_flagged(36.1));
    }
