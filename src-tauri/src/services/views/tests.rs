
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
        let (_, flagged) = domain::oil_add(&p, &wo, "15W-40", 40.0, Some(105_100), 9).unwrap();
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

    /// Client twin of maint-rust `falcon_mileage_counts_as_a_reading_in_the_view`
    /// (0019): an oil change recorded in Falcon lifts cars.mileage past the
    /// fuel reading, and the odometer must follow it.
    #[test]
    fn falcon_mileage_counts_as_a_reading() {
        let p = pool();
        seed_vehicle(&p, 11, "ف ر ع 1200", 200_000);
        let set_mileage = |km: i64| {
            p.get()
                .unwrap()
                .execute(
                    "UPDATE vehicles_cache SET mileage = ?1, mileage_changed_at = ?2 WHERE id = 11",
                    params![km, domain::now_iso()],
                )
                .unwrap();
            std::thread::sleep(std::time::Duration::from_millis(5));
        };
        set_mileage(204_500);
        let o = odometer_truth(&p, 11).unwrap().unwrap();
        assert_eq!((o.km, o.source.as_str()), (204_500, "falcon_mileage"));

        // A downward correction supersedes BOTH Falcon readings — the fuel
        // reading (200,000) is not the larger one and used to win here.
        domain::override_set(&p, 11, 150_000, None, 9).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let o = odometer_truth(&p, 11).unwrap().unwrap();
        assert_eq!((o.km, o.source.as_str()), (150_000, "manual_override"));

        set_mileage(205_000);
        let o = odometer_truth(&p, 11).unwrap().unwrap();
        assert_eq!((o.km, o.source.as_str()), (205_000, "falcon_mileage"));
    }

    /// The reported freeze: a typo'd Falcon reading is corrected DOWN, then the
    /// truck refuels at a real, higher value that is still below the typo.
    #[test]
    fn the_odometer_moves_again_after_a_downward_correction() {
        let p = pool();
        seed_vehicle(&p, 12, "ف ر ع 1300", 4_123_000);
        std::thread::sleep(std::time::Duration::from_millis(5));
        domain::override_set(&p, 12, 412_300, None, 9).unwrap();
        assert_eq!(odometer_truth(&p, 12).unwrap().unwrap().km, 412_300);
        std::thread::sleep(std::time::Duration::from_millis(5));
        p.get()
            .unwrap()
            .execute(
                "UPDATE vehicles_cache SET last_fuel_odometer = 418000, fuel_odometer_changed_at = ?1 WHERE id = 12",
                params![domain::now_iso()],
            )
            .unwrap();
        let o = odometer_truth(&p, 12).unwrap().unwrap();
        assert_eq!((o.km, o.source.as_str()), (418_000, "falcon_fuel"));
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

    // ───────────── 2026-11 audit: corrections, groups, due clocks ─────────────

    fn outbox_rows(pool: &DbPool) -> Vec<(String, String, String, Option<String>, serde_json::Value)> {
        let conn = pool.get().unwrap();
        let mut stmt = conn
            .prepare("SELECT entity_type, entity_id, op, group_id, payload FROM outbox WHERE status IN ('pending','inflight') ORDER BY seq")
            .unwrap();
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, serde_json::from_str(&r.get::<_, String>(4)?).unwrap()))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        rows
    }
    fn mark_all_sent(pool: &DbPool) {
        pool.get().unwrap().execute("UPDATE outbox SET sent = 1", []).unwrap();
    }
    fn rule_code(e: crate::AppError) -> String {
        match e {
            crate::AppError::Rule { code, .. } => code.to_string(),
            other => panic!("expected a rule, got {other:?}"),
        }
    }
    fn truck_with_chassis(p: &DbPool, id: i64, km: i64) -> Vec<String> {
        seed_vehicle(p, id, &format!("ن ص ر {id}"), km);
        domain::chassis_create(p, id, &ChassisConfig { drive_axles: 1, trailer_axles: 0, spares: 0, single_trailer_axles: None }, 9).unwrap();
        chassis_get(p, id).unwrap().unwrap().positions.into_iter().map(|x| x.id).collect()
    }

    #[test]
    fn one_action_is_one_group_and_updates_carry_only_what_changed() {
        let p = pool();
        seed_vehicle(&p, 1, "ف ل ص 1", 100_000);
        let wo = domain::wo_open(&p, 1, Some(100_500), 9).unwrap();
        domain::oil_add(&p, &wo, "15W-40", 35.0, Some(100_500), 9).unwrap();
        let rows = outbox_rows(&p);
        assert_eq!(rows.len(), 3);
        assert_ne!(rows[0].3, rows[1].3, "opening the WO and adding oil are separate actions");
        assert_eq!(rows[1].3, rows[2].3, "the oil change and its task are one action");
        assert!(rows[1].4.get("sync_version").is_none() && rows[1].4.get("created_at").is_none(), "no server-owned columns");

        // Once sent, closing the WO queues a small update — not the whole row.
        mark_all_sent(&p);
        domain::wo_close(&p, &wo, 9).unwrap();
        let rows = outbox_rows(&p);
        let close = rows.last().unwrap();
        assert_eq!(close.2, "update");
        let keys: Vec<&String> = close.4.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 3, "{keys:?}");
        assert!(close.4.get("status").is_some() && close.4.get("closed_at").is_some() && close.4.get("id").is_some());
    }

    #[test]
    fn a_wrong_mount_and_a_wrong_dismount_can_be_undone() {
        let p = pool();
        let pos = truck_with_chassis(&p, 2, 200_000);
        seed_stock(&p);
        let wo = domain::wo_open(&p, 2, Some(200_000), 9).unwrap();
        let mount = |position: &str| {
            domain::mount_from_stock(
                &p,
                &MountFromStockInput {
                    position_id: position.to_string(),
                    vehicle_id: 2,
                    work_order_id: wo.clone(),
                    brand: "Pirelli".into(),
                    model: Some("FR01".into()),
                    size: Some("315/80R22.5".into()),
                    dot_code: None,
                    odometer: Some(200_000),
                },
                9,
            )
            .unwrap()
        };

        // Mounted by mistake, nothing sent yet: the undo leaves no trace at all.
        let (tire, asg) = mount(&pos[0]);
        domain::mount_undo(&p, &asg, 9).unwrap();
        assert!(tire_file(&p, &tire).unwrap().is_none());
        assert!(outbox_rows(&p).iter().all(|r| r.1 != tire && r.1 != asg), "never sent, so nothing to send");
        assert_eq!(stock_view(&p).unwrap().tires[0].projected_qty, 5, "the stock tire is back");

        // Same mistake after it reached the server: both deletes are queued.
        let (tire, asg) = mount(&pos[0]);
        mark_all_sent(&p);
        domain::mount_undo(&p, &asg, 9).unwrap();
        let rows = outbox_rows(&p);
        let deletes: Vec<&str> = rows.iter().filter(|r| r.2 == "delete").map(|r| r.0.as_str()).collect();
        assert_eq!(deletes, vec!["tire_assignments", "tires"]);
        assert!(tire_file(&p, &tire).unwrap().is_none());

        // A real mount, then the wrong tire is taken off as "worn" (scrapped).
        let (tire, asg) = mount(&pos[0]);
        domain::dismount(&p, &DismountInput { assignment_id: asg.clone(), odometer: Some(201_000), reason: "worn".into(), work_order_id: Some(wo.clone()) }, 9).unwrap();
        assert_eq!(tire_file(&p, &tire).unwrap().unwrap().tire.status, "scrapped");
        // The reason was wrong…
        domain::dismount_set_reason(&p, &asg, "rotation", 9).unwrap();
        assert_eq!(tire_file(&p, &tire).unwrap().unwrap().tire.status, "in_stock_used");
        // …in fact it should never have come off.
        domain::dismount_undo(&p, &asg, 9).unwrap();
        let f = tire_file(&p, &tire).unwrap().unwrap();
        assert_eq!(f.tire.status, "mounted");
        assert!(f.mounts[0].dismounted_at.is_none() && f.mounts[0].dismount_reason.is_none());
        // A mounted tire cannot be deleted; a mount that is closed cannot be "un-mounted".
        assert_eq!(rule_code(domain::tire_delete(&p, &tire, 9).unwrap_err()), "tire_mounted");
        domain::dismount(&p, &DismountInput { assignment_id: asg.clone(), odometer: None, reason: "rotation".into(), work_order_id: None }, 9).unwrap();
        assert_eq!(rule_code(domain::mount_undo(&p, &asg, 9).unwrap_err()), "already_dismounted");
        // Odometers cannot run backwards.
        assert_eq!(rule_code(domain::assignment_set_odometers(&p, &asg, None, Some(5), 9).unwrap_err()), "odometer_backwards");
    }

    #[test]
    fn rules_are_refused_with_codes_before_anything_is_written() {
        let p = pool();
        let pos = truck_with_chassis(&p, 3, 50_000);
        truck_with_chassis(&p, 4, 60_000);
        let wo = domain::wo_open(&p, 3, None, 9).unwrap();
        let before = outbox_rows(&p).len();
        let bad_mount = MountFromStockInput {
            position_id: pos[0].clone(),
            vehicle_id: 4,
            work_order_id: wo.clone(),
            brand: "B".into(),
            model: None,
            size: None,
            dot_code: None,
            odometer: None,
        };
        assert_eq!(rule_code(domain::mount_from_stock(&p, &bad_mount, 9).unwrap_err()), "wo_wrong_vehicle");
        assert_eq!(rule_code(domain::wo_open(&p, 999, None, 9).unwrap_err()), "vehicle_not_found");
        assert_eq!(rule_code(domain::wo_open(&p, 3, Some(-4), 9).unwrap_err()), "odometer_range");
        assert_eq!(rule_code(domain::oil_add(&p, &wo, "15W-40", 0.0, None, 9).unwrap_err()), "liters_range");
        assert_eq!(rule_code(domain::oil_add(&p, &wo, " ", 35.0, None, 9).unwrap_err()), "oil_type_required");
        assert_eq!(rule_code(domain::wo_add_task(&p, &wo, None, None, "  ", 9).unwrap_err()), "task_empty");
        assert_eq!(rule_code(domain::record_baseline(&p, 3, "oil_change", "2999-01-01", None, 9).unwrap_err()), "date_in_future");
        domain::wo_close(&p, &wo, 9).unwrap();
        assert_eq!(rule_code(domain::wo_add_task(&p, &wo, None, None, "x", 9).unwrap_err()), "wo_closed");
        assert_eq!(rule_code(domain::oil_add(&p, &wo, "15W-40", 35.0, None, 9).unwrap_err()), "wo_closed");
        assert_eq!(outbox_rows(&p).len(), before, "only the close was queued (folded into the unsent insert)");
    }

    #[test]
    fn a_work_order_opened_by_mistake_can_be_removed_unless_it_has_real_work() {
        let p = pool();
        seed_vehicle(&p, 5, "ف ل ص 5", 4_123_000);
        seed_stock(&p);
        let wo = domain::wo_open(&p, 5, Some(4_999_000), 9).unwrap();
        assert_eq!(odometer_truth(&p, 5).unwrap().unwrap().km, 4_999_000, "its typo'd reading is the odometer");
        domain::wo_add_task(&p, &wo, Some("brakes"), None, "x", 9).unwrap();
        let (oil, _) = domain::oil_add(&p, &wo, "15W-40", 35.0, None, 9).unwrap();
        assert_eq!(rule_code(domain::wo_delete(&p, &wo, 9).unwrap_err()), "wo_not_empty");

        domain::oil_delete(&p, &oil, 9).unwrap();
        let d = wo_detail(&p, &wo).unwrap().unwrap();
        assert!(d.oil_changes.is_empty());
        assert!(d.tasks.iter().all(|t| t.kind != "oil"), "the oil task went with the last oil change");
        domain::wo_delete(&p, &wo, 9).unwrap();
        assert!(wo_detail(&p, &wo).unwrap().is_none());
        assert_eq!(odometer_truth(&p, 5).unwrap().unwrap().km, 4_123_000, "and its reading no longer counts");
        assert!(outbox_rows(&p).is_empty(), "nothing had been sent, so nothing is left to send");
    }

    #[test]
    fn an_oil_change_can_be_corrected() {
        let p = pool();
        seed_vehicle(&p, 6, "ف ل ص 6", 10_000);
        let wo = domain::wo_open(&p, 6, None, 9).unwrap();
        let (oil, flagged) = domain::oil_add(&p, &wo, "15W-40", 350.0, None, 9).unwrap();
        assert!(flagged);
        mark_all_sent(&p);
        assert!(!domain::oil_update(&p, &oil, "15W-40", 35.0, Some(10_050), 9).unwrap());
        let d = wo_detail(&p, &wo).unwrap().unwrap();
        assert_eq!((d.oil_changes[0].liters, d.oil_changes[0].flagged), (35.0, false));
        let rows = outbox_rows(&p);
        let last = rows.last().unwrap();
        assert_eq!((last.0.as_str(), last.2.as_str()), ("oil_changes", "update"));
        assert!(last.4.get("flagged").is_none(), "the flag is the server's to compute");
    }

    #[test]
    fn a_plan_with_km_and_days_is_due_on_whichever_comes_first() {
        let p = pool();
        seed_vehicle(&p, 7, "ف ل ص 7", 105_000);
        seed_plan(&p, "tractor", "oil_change", 10_000);
        p.get().unwrap().execute("UPDATE service_plans SET interval_days = 180", []).unwrap();
        domain::class_assign(&p, 7, "tractor", 9).unwrap();
        assert_eq!(due_board(&p, Some(7)).unwrap()[0].status, "never_done");

        // Done 200 days ago at 100,000 km: km in hand, time ran out.
        let long_ago = (chrono::Utc::now() - chrono::Duration::days(200)).format("%Y-%m-%d").to_string();
        domain::record_baseline(&p, 7, "oil_change", &long_ago, Some(100_000), 9).unwrap();
        let d = &due_board(&p, Some(7)).unwrap()[0];
        assert_eq!(d.status, "overdue");
        assert_eq!(d.km_remaining, Some(5_000));
        assert!(d.days_remaining.unwrap() <= -19, "{:?}", d.days_remaining);

        // A task ticked TODAY on a work order with no odometer restarts the
        // time clock from today and keeps the older km baseline.
        let wo = domain::wo_open(&p, 7, None, 9).unwrap();
        let task = domain::wo_add_task(&p, &wo, Some("oil_change"), None, "", 9).unwrap();
        assert_eq!(due_board(&p, Some(7)).unwrap()[0].status, "overdue", "a planned task is not done work");
        domain::wo_task_set_done(&p, &task, true, 9).unwrap();
        let d = &due_board(&p, Some(7)).unwrap()[0];
        assert_eq!(d.status, "ok");
        assert_eq!(d.last_km, Some(100_000));
        assert!((179..=180).contains(&d.days_remaining.unwrap()), "{:?}", d.days_remaining);
        domain::wo_task_set_done(&p, &task, false, 9).unwrap();
        assert_eq!(due_board(&p, Some(7)).unwrap()[0].status, "overdue", "unticking takes it back");
    }

    #[test]
    fn a_typed_type_is_matched_or_created_and_typed_jobs_join_their_type() {
        let p = pool();
        seed_vehicle(&p, 11, "ف ل ص 11", 50_000);
        let wo = domain::wo_open(&p, 11, None, 9).unwrap();
        // A name a type already has is that type (spacing and letter variants
        // aside): the seeded "تشحيم" is 'greasing'.
        let t = domain::wo_add_task(&p, &wo, None, Some("  تشحيم "), "تشحيم كرنك", 9).unwrap();
        let conn = p.get().unwrap();
        let (cat, name): (Option<String>, Option<String>) = conn
            .query_row("SELECT category_id, category_name_ar FROM work_order_tasks WHERE id = ?1", [&t], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((cat.as_deref(), name), (Some("greasing"), None));
        // The typed job joined the type's jobs at once.
        let job_cat: String = conn.query_row("SELECT category_id FROM standard_jobs WHERE name_ar = 'تشحيم كرنك'", [], |r| r.get(0)).unwrap();
        assert_eq!(job_cat, "greasing");
        drop(conn);
        // A new name makes a type, the same id on every device; only a type: no job of its name.
        let t = domain::wo_add_task(&p, &wo, None, Some("كهربا"), "", 9).unwrap();
        let conn = p.get().unwrap();
        let (cat, name, desc): (String, Option<String>, Option<String>) = conn
            .query_row("SELECT category_id, category_name_ar, description_ar FROM work_order_tasks WHERE id = ?1", [&t], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        let expect = format!("c-{}", uuid::Uuid::new_v5(&domain::CATEGORY_NAMESPACE, domain::norm_key("كهربا").as_bytes()));
        assert_eq!((cat.as_str(), name.as_deref(), desc.as_deref()), (expect.as_str(), Some("كهربا"), Some("كهربا")));
        let listed: i64 = conn.query_row("SELECT COUNT(*) FROM maintenance_categories WHERE id = ?1", [&cat], |r| r.get(0)).unwrap();
        assert_eq!(listed, 1);
        let jobs: i64 = conn.query_row("SELECT COUNT(*) FROM standard_jobs WHERE name_ar = 'كهربا'", [], |r| r.get(0)).unwrap();
        assert_eq!(jobs, 0);
        drop(conn);
        // A mirror refresh keeps it until the server has it.
        crate::services::refdata::replace_categories(&p, &[]).unwrap();
        let conn = p.get().unwrap();
        let listed: i64 = conn.query_row("SELECT COUNT(*) FROM maintenance_categories WHERE id = ?1", [&cat], |r| r.get(0)).unwrap();
        assert_eq!(listed, 1);
        // A catalog refresh before the task is sent keeps the typed job; once
        // the server lists it, it is the server's row (no twin).
        let jobs_named = |p: &DbPool| -> Vec<String> {
            let conn = p.get().unwrap();
            let mut stmt = conn.prepare("SELECT id FROM standard_jobs WHERE name_ar = 'تشحيم كرنك'").unwrap();
            stmt.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
        };
        let empty = serde_json::json!({"tire_products": [], "oil_products": [], "standard_jobs": []});
        crate::services::refdata::replace_catalog(&p, &empty).unwrap();
        assert_eq!(jobs_named(&p).len(), 1);
        let server = serde_json::json!({"tire_products": [], "oil_products": [],
            "standard_jobs": [{"id": "77", "name_ar": "تشحيم  كرنك", "category_id": "greasing", "uses": 1}]});
        crate::services::refdata::replace_catalog(&p, &server).unwrap();
        assert_eq!(jobs_named(&p), Vec::<String>::new(), "the server's spelling is the one row");
        // The key folds what the server's maint_norm folds.
        assert_eq!(domain::norm_key(" إصلاح  بنشر ٢ "), domain::norm_key("اصلاح بنشر 2"));
    }

    #[test]
    fn work_from_old_office_invoices_counts_toward_the_plan() {
        let p = pool();
        seed_vehicle(&p, 8, "ف ل ص 8", 103_000);
        seed_plan(&p, "tractor", "oil_change", 10_000);
        domain::class_assign(&p, 8, "tractor", 9).unwrap();
        assert_eq!(due_board(&p, Some(8)).unwrap()[0].status, "never_done");
        // What the server sends: Postgres timestamps with an offset.
        let rows = vec![
            serde_json::json!({"id": 1, "vehicle_id": 8, "category_id": "oil_change", "done_at": "2026-01-05T10:00:00.123456+02:00", "km": 90_000}),
            serde_json::json!({"id": 2, "vehicle_id": 8, "category_id": "oil_change", "done_at": "2026-09-05T10:00:00+03:00", "km": 99_000}),
            serde_json::json!({"id": 3, "vehicle_id": 8, "category_id": null, "done_at": "2026-10-01T10:00:00+03:00", "km": 1}),
        ];
        crate::services::refdata::replace_legacy_events(&p, &rows).unwrap();
        let d = &due_board(&p, Some(8)).unwrap()[0];
        assert_eq!((d.last_km, d.km_remaining), (Some(99_000), Some(6_000)), "the newest recognised line is the baseline");
        assert_ne!(d.status, "never_done");
        // A refresh without them (the invoice was deleted) takes them away.
        crate::services::refdata::replace_legacy_events(&p, &[]).unwrap();
        assert_eq!(due_board(&p, Some(8)).unwrap()[0].status, "never_done");
    }

    #[test]
    fn truck_cards_tell_untracked_from_fine_and_agree_with_the_home_counts() {
        let p = pool();
        seed_vehicle(&p, 8, "ف ل ص 8", 10_000);
        seed_vehicle(&p, 9, "ف ل ص 9", 10_000);
        seed_plan(&p, "tractor", "oil_change", 10_000);
        domain::class_assign(&p, 8, "tractor", 9).unwrap();
        let trucks = truck_list(&p, None).unwrap();
        let (a, b) = (&trucks[0], &trucks[1]);
        assert_eq!((a.plan_count, a.never_done_count, a.overdue_count), (1, 1, 0), "never done is not 'overdue'");
        assert_eq!(b.plan_count, 0, "no class: nothing tracked, not 'all good'");
        let home = home_summary(&p).unwrap();
        assert_eq!((home.due_counts.never_done, home.due_counts.overdue, home.due_counts.unclassified_trucks), (1, 0, 1));
        // Removing the class takes the truck off the board.
        domain::class_unassign(&p, 8, 9).unwrap();
        assert!(due_board(&p, None).unwrap().is_empty());
    }

    #[test]
    fn search_ignores_spaces_digit_scripts_and_letter_variants() {
        let p = pool();
        seed_vehicle(&p, 10, "أ ص ر 8351", 1);
        for q in ["اصر 8351", "أصر٨٣٥١", "ا ص ر", "8351", "٨٣٥١"] {
            assert_eq!(truck_list(&p, Some(q)).unwrap().len(), 1, "{q}");
            assert_eq!(search_all(&p, q).unwrap().trucks.len(), 1, "{q}");
        }
        assert!(truck_list(&p, Some("زز")).unwrap().is_empty());
        assert_eq!(fold_search(" Ab-1 "), "AB1");
    }

    #[test]
    fn a_tire_can_be_edited_and_its_km_says_when_it_is_incomplete() {
        let p = pool();
        let pos = truck_with_chassis(&p, 11, 300_000);
        let (tire, _) = domain::onboard_position(
            &p,
            &domain::OnboardPositionInput {
                position_id: pos[0].clone(),
                vehicle_id: 11,
                brand: "Pireli".into(),
                model: None,
                size: None,
                dot_code: None,
                estimated_km: Some(40_000),
                odometer: None,
            },
            9,
        )
        .unwrap();
        let f = tire_file(&p, &tire).unwrap().unwrap();
        assert!(f.tire.km_incomplete, "no odometer at mount: km from here cannot be counted");
        assert_eq!(f.mounts[0].plate.as_deref(), Some("ن ص ر 11"));
        domain::tire_update(
            &p,
            &tire,
            &domain::TireEditInput { brand: "Pirelli".into(), model: Some("FR01".into()), size: None, dot_code: Some("1224".into()), base_km: 45_000, notes: None },
            9,
        )
        .unwrap();
        let t = tire_file(&p, &tire).unwrap().unwrap().tire;
        assert_eq!((t.brand.as_str(), t.dot_code.as_deref(), t.base_km), ("Pirelli", Some("1224"), 45_000));
        assert_eq!(tires_list(&p, None, Some("fr01")).unwrap().len(), 1, "model is searchable");
    }

