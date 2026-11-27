//! END-TO-END: the real engine against a real maint-rust.
//!
//! Everything below the HTTP seam is unit-tested; this suite exists because
//! the seam is where the old engine lost data — a lost ack, two devices on
//! one record, a change the server refuses. Each test drives one or two
//! "devices" (own SQLite file, own session) through the real `/sync/push`,
//! `/sync/pull` and `/records`.
//!
//! Needs a running maint-rust and a token for it:
//!
//!   APEX_E2E_BASE_URL   e.g. http://127.0.0.1:8095
//!   APEX_E2E_JWT        HS256 admin_user token signed with the server's secret
//!
//! Skips (passes vacuously) when unset, so plain `cargo test` stays green.

use std::sync::Arc;

use apex_maintenance_lib::config::AppConfig;
use apex_maintenance_lib::db::DbPool;
use apex_maintenance_lib::http_client::HttpClient;
use apex_maintenance_lib::services::domain::{
    self, BatteryDetailsInput, BatteryFitNewInput, BatteryRemoveInput, BatterySpecInput, ChassisConfig, DismountInput,
    MountFromStockInput,
};
use apex_maintenance_lib::services::engine::SyncEngine;
use apex_maintenance_lib::services::{outbox, views};
use apex_maintenance_lib::session_store;

const USER: i64 = 77;

struct Env {
    base_url: String,
    jwt: String,
}

fn e2e_env() -> Option<Env> {
    Some(Env { base_url: std::env::var("APEX_E2E_BASE_URL").ok()?, jwt: std::env::var("APEX_E2E_JWT").ok()? })
}

struct Device {
    pool: Arc<DbPool>,
    engine: SyncEngine,
    http: Arc<HttpClient>,
    _dir: tempfile::TempDir,
}

/// A fresh device signed in as USER, knowing `vehicle_id` in its fleet mirror.
fn device(env: &Env, vehicle_id: i64) -> Device {
    std::env::set_var("APEX_BASE_URL", &env.base_url);
    std::env::set_var("APEX_MAINT_PREFIX", "/api/maint");
    std::env::set_var("APEX_REQUEST_TIMEOUT_SECS", "5");

    let dir = tempfile::tempdir().expect("tempdir");
    session_store::store_jwt(dir.path(), &env.jwt).expect("store jwt");
    session_store::store_user_json(dir.path(), &format!(r#"{{"id":{USER},"email":"e2e","name":"e2e","permission":4,"driver_id":0,"jwt_exp":0}}"#))
        .expect("store user");

    let pool = Arc::new(DbPool::open(&dir.path().join("e2e.db")).expect("open db"));
    pool.run_migrations().expect("migrations");
    {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO vehicles_cache (id, car_no_plate, last_fuel_odometer, raw_payload, fetched_at)
             VALUES (?1, 'E2E 8351', 100000, '{}', ?2)",
            rusqlite::params![vehicle_id, chrono::Utc::now().to_rfc3339()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tire_stock_cache (id, brand, model, size, on_hand_qty) VALUES ('s', 'E2E', 'M', 'S', 10)",
            [],
        )
        .unwrap();
    }
    let config = Arc::new(AppConfig::load());
    let http = Arc::new(HttpClient::new(config, dir.path().to_path_buf()).expect("http client"));
    Device { pool: pool.clone(), engine: SyncEngine::new(pool, http.clone(), 50, 200), http, _dir: dir }
}

fn vehicle() -> i64 {
    3_000_000 + (uuid::Uuid::new_v4().as_u128() % 100_000_000) as i64
}

async fn sync(d: &Device) {
    d.engine.drain().await.expect("drain");
    d.engine.pull().await.expect("pull");
}

fn pending(d: &Device) -> i64 {
    d.engine.status().unwrap().pending
}

fn issues(d: &Device) -> Vec<outbox::SyncIssue> {
    outbox::list_issues(&d.pool.get().unwrap(), 50).unwrap()
}

fn mount_new(d: &Device, vehicle_id: i64, wo: &str, position: &str) -> (String, String) {
    domain::mount_from_stock(
        &d.pool,
        &MountFromStockInput {
            position_id: position.to_string(),
            vehicle_id,
            work_order_id: wo.to_string(),
            brand: "E2E".into(),
            model: Some("M".into()),
            size: Some("S".into()),
            dot_code: None,
            odometer: Some(100_500),
        },
        USER,
    )
    .expect("mount")
}

#[tokio::test]
async fn a_day_of_offline_work_syncs_and_a_second_device_sees_it() {
    let Some(env) = e2e_env() else { return };
    let v = vehicle();
    let a = device(&env, v);

    domain::chassis_create(&a.pool, v, &ChassisConfig { drive_axles: 2, trailer_axles: 3, spares: 1, single_trailer_axles: None }, USER)
        .expect("chassis");
    let positions = views::chassis_get(&a.pool, v).unwrap().unwrap().positions;
    let wo = domain::wo_open(&a.pool, v, Some(100_500), USER).expect("wo");
    let task = domain::wo_add_task(&a.pool, &wo, Some("brakes"), None, "تيل فرامل", USER).expect("task");
    domain::wo_task_set_done(&a.pool, &task, true, USER).expect("tick");
    domain::oil_add(&a.pool, &wo, "E2E-OIL", 40.0, Some(100_500), USER).expect("oil");
    let (tire, asg) = mount_new(&a, v, &wo, &positions[0].id);
    domain::dismount(&a.pool, &DismountInput { assignment_id: asg, odometer: Some(140_500), reason: "worn".into(), work_order_id: Some(wo.clone()) }, USER)
        .expect("dismount");
    domain::wo_close(&a.pool, &wo, USER).expect("close");
    assert!(pending(&a) >= 25, "queued locally: {}", pending(&a));

    sync(&a).await;
    let s = a.engine.status().unwrap();
    assert!(s.online);
    assert_eq!((s.pending, s.issues), (0, 0), "everything went through: {:?} {:?}", s.last_error, issues(&a));

    // A second device starts empty and pulls the same truth.
    let b = device(&env, v);
    sync(&b).await;
    let d = views::wo_detail(&b.pool, &wo).unwrap().expect("the work order arrived");
    assert_eq!(d.wo.status, "closed");
    assert!(d.tasks.iter().any(|t| t.id == task && t.is_done && t.done_at.is_some()), "{:?}", d.tasks);
    assert_eq!(d.oil_changes.len(), 1);
    assert!(d.oil_changes[0].flagged, "the server owns the flag: 40 L is outside 34–36");
    let t = views::tire_file(&b.pool, &tire).unwrap().expect("the tire arrived");
    assert_eq!(t.tire.status, "scrapped", "server derived it from the dismount reason");
    assert_eq!(t.tire.total_km, 40_000, "km derived from the mount on both devices");
    assert_eq!(views::chassis_get(&b.pool, v).unwrap().unwrap().positions.len(), positions.len());
}

#[tokio::test]
async fn a_lost_acknowledgement_loses_nothing_and_duplicates_nothing() {
    let Some(env) = e2e_env() else { return };
    let v = vehicle();
    let a = device(&env, v);
    let wo = domain::wo_open(&a.pool, v, None, USER).unwrap();
    let task = domain::wo_add_task(&a.pool, &wo, None, None, "x", USER).unwrap();
    a.engine.drain().await.unwrap();
    assert_eq!(pending(&a), 0);

    // The server applied both ops, but pretend the answer never arrived: the
    // rows go back to the queue exactly as they were sent.
    {
        let conn = a.pool.get().unwrap();
        conn.execute("UPDATE outbox SET status = 'pending', synced_at = NULL", []).unwrap();
        conn.execute("UPDATE work_orders SET sync_version = 1", []).unwrap();
        conn.execute("UPDATE work_order_tasks SET sync_version = 1", []).unwrap();
    }
    // Meanwhile the user ticks the task (the old engine folded this into the
    // insert being re-sent, and the server threw it away).
    domain::wo_task_set_done(&a.pool, &task, true, USER).unwrap();
    domain::wo_close(&a.pool, &wo, USER).unwrap();
    sync(&a).await;
    assert_eq!((pending(&a), issues(&a).len()), (0, 0), "{:?}", issues(&a));

    let b = device(&env, v);
    sync(&b).await;
    let d = views::wo_detail(&b.pool, &wo).unwrap().unwrap();
    assert_eq!(d.wo.status, "closed", "the close survived the replay");
    assert_eq!(d.tasks.len(), 1, "no duplicate task");
    assert!(d.tasks[0].is_done, "the tick survived the replay");
}

#[tokio::test]
async fn two_devices_editing_one_work_order_keep_both_changes() {
    let Some(env) = e2e_env() else { return };
    let v = vehicle();
    let a = device(&env, v);
    let wo = domain::wo_open(&a.pool, v, Some(100_100), USER).unwrap();
    sync(&a).await;
    let b = device(&env, v);
    sync(&b).await;

    // Both edit while apart: A writes notes, B closes.
    domain::wo_set_notes(&a.pool, &wo, Some("فرامل"), Some("العميل مستعجل"), USER).unwrap();
    domain::wo_close(&b.pool, &wo, USER).unwrap();
    sync(&a).await;
    sync(&b).await; // B's close is based on a stale version → merged and retried
    sync(&b).await;
    assert_eq!((pending(&b), issues(&b).len()), (0, 0), "a merge is not an error: {:?}", issues(&b));
    sync(&a).await;
    for d in [&a, &b] {
        let w = views::wo_detail(&d.pool, &wo).unwrap().unwrap().wo;
        assert_eq!(w.status, "closed");
        assert_eq!(w.title.as_deref(), Some("فرامل"));
        assert_eq!(w.notes.as_deref(), Some("العميل مستعجل"));
    }
}

#[tokio::test]
async fn a_mount_the_server_refuses_is_undone_and_explained() {
    let Some(env) = e2e_env() else { return };
    let v = vehicle();
    let a = device(&env, v);
    domain::chassis_create(&a.pool, v, &ChassisConfig { drive_axles: 1, trailer_axles: 0, spares: 0, single_trailer_axles: None }, USER).unwrap();
    let wo = domain::wo_open(&a.pool, v, None, USER).unwrap();
    sync(&a).await;
    let b = device(&env, v);
    sync(&b).await;
    let position = views::chassis_get(&a.pool, v).unwrap().unwrap().positions[0].id.clone();

    // Both garages fit a new tire on the same wheel while offline.
    let (tire_a, _) = mount_new(&a, v, &wo, &position);
    let (tire_b, _) = mount_new(&b, v, &wo, &position);
    sync(&a).await;
    sync(&b).await;

    assert_eq!(pending(&b), 0, "nothing is left stuck in the queue");
    let notes = issues(&b);
    assert_eq!(notes.len(), 1, "one note for the one refused action: {notes:?}");
    assert_eq!(notes[0].code, "position_occupied");
    assert!(views::tire_file(&b.pool, &tire_b).unwrap().is_none(), "the tire that never existed is gone");
    let ch = views::chassis_get(&b.pool, v).unwrap().unwrap();
    assert_eq!(ch.positions[0].tire_id.as_deref(), Some(tire_a.as_str()), "B now shows what is really on the wheel");
    // And B can carry on working on that truck.
    domain::wo_add_task(&b.pool, &wo, None, None, "بعد التصحيح", USER).unwrap();
    sync(&b).await;
    assert_eq!(pending(&b), 0);
}

#[tokio::test]
async fn a_full_resync_removes_rows_the_server_does_not_have() {
    let Some(env) = e2e_env() else { return };
    let v = vehicle();
    let a = device(&env, v);
    let wo = domain::wo_open(&a.pool, v, None, USER).unwrap();
    sync(&a).await;
    // A leftover the server never had (an older build kept refused work).
    a.pool
        .get()
        .unwrap()
        .execute("INSERT INTO work_orders (id, vehicle_id, status, opened_at, sync_version) VALUES ('ghost', ?1, 'open', '2026-01-01T00:00:00Z', 1)", [v])
        .unwrap();
    let s = a.engine.resync().await.expect("resync");
    assert!(s.removed >= 1, "{s:?}");
    assert!(views::wo_detail(&a.pool, "ghost").unwrap().is_none());
    assert!(views::wo_detail(&a.pool, &wo).unwrap().is_some(), "real rows stay");
}

#[tokio::test]
async fn offline_keeps_the_work_and_spends_no_retries() {
    let Some(env) = e2e_env() else { return };
    let dead = Env { base_url: "http://127.0.0.1:59999".into(), jwt: env.jwt.clone() };
    let v = vehicle();
    let c = device(&dead, v);
    domain::override_set(&c.pool, v, 123_456, None, USER).expect("override");
    c.engine.drain().await.expect("drain must not error outward");
    let status = c.engine.status().expect("status");
    assert!(!status.online, "connection refused ⇒ offline");
    assert_eq!((status.pending, status.issues), (1, 0), "the write survives, nothing is refused");
    let conn = c.pool.get().unwrap();
    assert_eq!(outbox::queued(&conn, 10).unwrap()[0].attempts, 0, "offline spends no retry budget");
}

#[tokio::test]
async fn a_typed_type_and_its_typed_job_reach_the_server_and_every_device() {
    let Some(env) = e2e_env() else { return };
    let v = vehicle();
    let a = device(&env, v);
    let tag = &uuid::Uuid::new_v4().simple().to_string()[..8];
    let new_type = format!("نوع تجربة {tag}");
    let new_job = format!("شغلانة تجربة {tag}");
    let greasing_job = format!("تشحيم تجربة {tag}");
    let wo = domain::wo_open(&a.pool, v, None, USER).unwrap();
    // A typed name an existing type already has is that type.
    domain::wo_add_task(&a.pool, &wo, None, Some(" تشحيم "), &greasing_job, USER).unwrap();
    // A new type, with a job typed under it.
    let task = domain::wo_add_task(&a.pool, &wo, None, Some(&new_type), &new_job, USER).unwrap();
    sync(&a).await;
    assert_eq!(pending(&a), 0, "{:?}", issues(&a));
    assert!(issues(&a).is_empty(), "{:?}", issues(&a));

    // The server created the type under the id the device minted…
    let minted = format!("c-{}", uuid::Uuid::new_v5(&domain::CATEGORY_NAMESPACE, domain::norm_key(&new_type).as_bytes()));
    let cats: Vec<serde_json::Value> = a.http.get("/categories").await.expect("categories");
    let made = cats.iter().find(|c| c["id"] == minted.as_str()).unwrap_or_else(|| panic!("{minted} not in {cats:?}"));
    assert_eq!(made["name_ar"], new_type.as_str());
    // …and learned both typed jobs under their types.
    let catalog: serde_json::Value = a.http.get("/catalog").await.expect("catalog");
    let job_type = |name: &str| {
        catalog["standard_jobs"].as_array().unwrap().iter().find(|j| j["name_ar"] == name).map(|j| j["category_id"].clone())
    };
    assert_eq!(job_type(&new_job), Some(serde_json::json!(minted)));
    assert_eq!(job_type(&greasing_job), Some(serde_json::json!("greasing")));
    assert_eq!(job_type(&new_type), None, "a type's own name is not one of its jobs");

    // A second device gets the task under that type.
    let b = device(&env, v);
    sync(&b).await;
    let d = views::wo_detail(&b.pool, &wo).unwrap().expect("wo on B");
    let t = d.tasks.iter().find(|t| t.id == task).expect("task on B");
    assert_eq!(t.category_id.as_deref(), Some(minted.as_str()));
}

#[tokio::test]
async fn a_battery_fitted_offline_reaches_the_server_and_counts_off_the_shelf() {
    let Some(env) = e2e_env() else { return };
    let v = vehicle();
    let a = device(&env, v);
    let brand = format!("E2E-B{}", &uuid::Uuid::new_v4().simple().to_string()[..6]);
    let body = serde_json::json!({"brand": brand, "capacity_ah": 100, "voltage": 12, "qty": 3, "ref_id": uuid::Uuid::new_v4().to_string()});
    a.http.maint_post_raw("/stock/batteries/credit", &body).await.expect("receive batteries");

    let wo = domain::wo_open(&a.pool, v, Some(100_500), USER).unwrap();
    let spec = BatterySpecInput { brand: brand.clone(), model: None, capacity_ah: Some(100), voltage: Some(12), cca: None };
    let details = BatteryDetailsInput { serial: Some("E2E-SN".into()), date_code: Some("2611".into()), warranty_months: Some(18), notes: None };
    let (_battery, install) = domain::battery_fit_new(
        &a.pool,
        &BatteryFitNewInput { vehicle_id: v, slot: 1, work_order_id: wo.clone(), spec, details, odometer: Some(100_500) },
        USER,
    )
    .expect("fit");
    domain::battery_slots_set(&a.pool, v, 3, USER).expect("slots");
    sync(&a).await;
    assert_eq!(pending(&a), 0, "{:?}", issues(&a));
    assert!(issues(&a).is_empty(), "{:?}", issues(&a));

    // The server took one off the shelf.
    let stock: Vec<serde_json::Value> = a.http.get("/stock/batteries").await.expect("battery stock");
    let line = stock.iter().find(|l| l["brand"] == brand.as_str()).expect("the product line");
    assert_eq!(line["on_hand_qty"], 2);

    // Off for a warranty claim.
    domain::battery_remove(
        &a.pool,
        &BatteryRemoveInput {
            install_id: install, odometer: Some(101_000), reason: "dead".into(), outcome: "warranty".into(), work_order_id: Some(wo),
        },
        USER,
    )
    .expect("remove");
    sync(&a).await;
    assert_eq!(pending(&a), 0, "{:?}", issues(&a));

    // A second device sees the slots, the removal and where the battery went.
    let b = device(&env, v);
    sync(&b).await;
    let t = views::battery_truck(&b.pool, v).unwrap();
    assert_eq!(t.slots.len(), 3);
    assert!(t.slots.iter().all(|s| s.fit.is_none()));
    assert_eq!(t.removed.len(), 1);
    assert_eq!((t.removed[0].battery.status.as_str(), t.removed[0].removal_reason.as_deref()), ("warranty", Some("dead")));
    assert_eq!(t.removed[0].battery.serial.as_deref(), Some("E2E-SN"));
    assert_eq!(t.removed[0].km, Some(500));
}
