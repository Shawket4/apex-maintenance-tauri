//! END-TO-END: the real engine against the real maint-rust binary.
//!
//! Everything below the HTTP seam is unit-tested; this test exists because the
//! seam is where facades hide — auth headers, envelope shapes, cursor echo,
//! per-op result correlation, conflict payloads, and now the server-side
//! derivations (stock debits, status/km projections) converging back to the
//! client through /sync/pull.
//!
//! Needs a running maint-rust + a JWT for it, provided via env (see
//! scripts/e2e_live.sh, which sets these up against a scratch Postgres):
//!
//!   APEX_E2E_BASE_URL   e.g. http://127.0.0.1:8091
//!   APEX_E2E_JWT        HS256 token signed with the server's JWT_SECRET
//!   APEX_E2E_VEHICLE_ID a vehicle id seeded in the server's vehicles_cache
//!
//! Skips (passes vacuously) when unset, so plain `cargo test` stays green.

use std::sync::Arc;

use apex_maintenance_lib::config::AppConfig;
use apex_maintenance_lib::db::DbPool;
use apex_maintenance_lib::http_client::HttpClient;
use apex_maintenance_lib::services::domain::{self, ChassisConfig, DismountInput, MountFromStockInput};
use apex_maintenance_lib::services::engine::SyncEngine;
use apex_maintenance_lib::services::outbox;
use apex_maintenance_lib::session_store;

struct Env {
    base_url: String,
    jwt: String,
    vehicle_id: i64,
}

fn e2e_env() -> Option<Env> {
    Some(Env {
        base_url: std::env::var("APEX_E2E_BASE_URL").ok()?,
        jwt: std::env::var("APEX_E2E_JWT").ok()?,
        vehicle_id: std::env::var("APEX_E2E_VEHICLE_ID").ok()?.parse().ok()?,
    })
}

struct Client {
    pool: Arc<DbPool>,
    engine: SyncEngine,
    _dir: tempfile::TempDir,
}

/// A fresh "device": its own SQLite file, its own data dir with the JWT laid
/// down the way the login flow would.
fn device(env: &Env) -> Client {
    std::env::set_var("APEX_BASE_URL", &env.base_url);
    std::env::set_var("APEX_MAINT_PREFIX", "/api/maint");
    std::env::set_var("APEX_REQUEST_TIMEOUT_SECS", "5");

    let dir = tempfile::tempdir().expect("tempdir");
    session_store::store_jwt(dir.path(), &env.jwt).expect("store jwt");

    let pool = Arc::new(DbPool::open(&dir.path().join("e2e.db")).expect("open db"));
    pool.run_migrations().expect("migrations");

    // The due query + domain flows join vehicles_cache locally.
    {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO vehicles_cache (id, car_no_plate, last_fuel_odometer, raw_payload, fetched_at)
             VALUES (?1, 'E2E 8351', 100000, '{}', ?2)",
            rusqlite::params![env.vehicle_id, chrono::Utc::now().to_rfc3339()],
        )
        .unwrap();
    }

    let config = Arc::new(AppConfig::load());
    let http = Arc::new(HttpClient::new(config, dir.path().to_path_buf()).expect("http client"));
    let engine = SyncEngine::new(pool.clone(), http, 50, 200);
    Client { pool, engine, _dir: dir }
}

fn seed_user_id() -> i64 {
    77
}

#[tokio::test]
async fn full_offline_day_replays_and_server_derivations_converge() {
    let Some(env) = e2e_env() else { return };
    let c = device(&env);
    let uid = seed_user_id();

    // ── work happens "offline": nothing has been pushed yet ────────────────
    let wo = domain::wo_open(&c.pool, env.vehicle_id, Some(105_000), uid).expect("wo_open");
    domain::wo_add_task(&c.pool, &wo, Some("brakes"), "تغيير تيل فرامل أمامي", uid).expect("task");
    let (oil_id, flagged) =
        domain::oil_add(&c.pool, &wo, env.vehicle_id, "15W-40", 40.0, Some(105_100), uid)
            .expect("oil");
    assert!(flagged, "40 L is outside the 34–36 band locally too");

    domain::chassis_create(
        &c.pool,
        env.vehicle_id,
        &ChassisConfig { drive_axles: 2, trailer_axles: 4, spares: 2, single_trailer_axles: None },
        uid,
    )
    .expect("chassis");

    let h2lo: String = {
        let conn = c.pool.get().unwrap();
        conn.query_row("SELECT id FROM chassis_positions WHERE position_code = 'H2LO'", [], |r| {
            r.get(0)
        })
        .unwrap()
    };
    let dot = format!("DOT E2E {}", &uuid::Uuid::new_v4().to_string()[..8]);
    let (tire_id, assignment_id) = domain::mount_from_stock(
        &c.pool,
        &MountFromStockInput {
            position_id: h2lo,
            vehicle_id: env.vehicle_id,
            work_order_id: wo.clone(),
            brand: "Pirelli".into(),
            model: Some("FR01".into()),
            size: Some("315/80R22.5".into()),
            dot_code: Some(dot),
            odometer: Some(105_100),
        },
        uid,
    )
    .expect("mount");

    let before = {
        let conn = c.pool.get().unwrap();
        outbox::counts(&conn).unwrap()
    };
    assert!(before.pending >= 40, "a full day queued locally, got {}", before.pending);

    // ── the network comes back: drain the whole backlog ────────────────────
    c.engine.drain().await.expect("drain");
    let status = c.engine.status().expect("status");
    assert!(status.online, "server reachable ⇒ online");
    assert_eq!(status.pending, 0, "backlog fully drained, {:?}", status.last_error);
    assert_eq!(status.dead, 0, "no dead letters on a clean replay: {:?}", {
        let conn = c.pool.get().unwrap();
        outbox::list_active(&conn, 10)
            .unwrap()
            .into_iter()
            .map(|i| (i.entity_type, i.last_error))
            .collect::<Vec<_>>()
    });

    // Acks adopted the server's sync_version locally.
    {
        let conn = c.pool.get().unwrap();
        let sv: i64 = conn
            .query_row("SELECT sync_version FROM work_orders WHERE id = ?1", [&wo], |r| r.get(0))
            .unwrap();
        assert!(sv >= 1, "server-assigned version adopted, got {sv}");
        let oil_flag: i64 = conn
            .query_row("SELECT flagged FROM oil_changes WHERE id = ?1", [&oil_id], |r| r.get(0))
            .unwrap();
        assert_eq!(oil_flag, 1, "flag survives locally");
    }

    // ── a second device pulls the same world ────────────────────────────────
    let c2 = device(&env);
    let summary = c2.engine.pull().await.expect("pull");
    assert!(summary.errors.is_empty(), "pull errors: {:?}", summary.errors);
    {
        let conn = c2.pool.get().unwrap();
        let wo_there: i64 = conn
            .query_row("SELECT COUNT(*) FROM work_orders WHERE id = ?1", [&wo], |r| r.get(0))
            .unwrap();
        assert_eq!(wo_there, 1, "device 2 received the work order");
        let positions: i64 =
            conn.query_row("SELECT COUNT(*) FROM chassis_positions", [], |r| r.get(0)).unwrap();
        assert_eq!(positions, 28, "device 2 received the whole chassis");
        let (status2, origin2): (String, String) = conn
            .query_row("SELECT status, origin FROM tires WHERE id = ?1", [&tire_id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(status2, "mounted", "server derived mounted status flowed to device 2");
        assert_eq!(origin2, "shipment");
    }

    // ── dismount converges: server derives status + km, pull adopts them ────
    domain::dismount(
        &c.pool,
        &DismountInput {
            assignment_id: assignment_id.clone(),
            odometer: Some(145_100),
            reason: "worn".into(),
            work_order_id: Some(wo.clone()),
        },
        uid,
    )
    .expect("dismount");
    // Local mirror of the derivation, applied immediately:
    {
        let conn = c.pool.get().unwrap();
        let (st, km): (String, i64) = conn
            .query_row("SELECT status, total_km FROM tires WHERE id = ?1", [&tire_id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(st, "scrapped");
        assert_eq!(km, 40_000);
    }
    c.engine.drain().await.expect("drain dismount");
    let _ = c.engine.pull().await.expect("pull back");
    {
        // After pulling the server's tires row, the local values must MATCH the
        // server's derivation — this is the drift alarm between the client and
        // server implementations of the same rule.
        let conn = c.pool.get().unwrap();
        let (st, km, sv): (String, i64, i64) = conn
            .query_row(
                "SELECT status, total_km, sync_version FROM tires WHERE id = ?1",
                [&tire_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(st, "scrapped", "server agreed: worn → scrapped");
        assert_eq!(km, 40_000, "server agreed on the km accrual");
        assert!(sv >= 2, "server bumped the tire row when deriving");
    }

    // ── stale write → per-op conflict → dead letter carrying the server row ─
    {
        let conn = c.pool.get().unwrap();
        // Fabricate staleness: pretend we never learned the server's version.
        conn.execute("UPDATE work_orders SET sync_version = 0 WHERE id = ?1", [&wo]).unwrap();
    }
    domain::wo_close(&c.pool, &wo, uid).expect("stale close enqueues");
    c.engine.drain().await.expect("drain 2");
    let status = c.engine.status().expect("status 2");
    assert_eq!(status.dead, 1, "stale write dead-letters instead of vanishing");
    {
        let conn = c.pool.get().unwrap();
        let dead = outbox::list_active(&conn, 10).unwrap();
        let d = dead.iter().find(|i| i.status == "dead").expect("dead row present");
        assert!(d.server_row.is_some(), "conflict carries the server row for the user");
        // Server-authoritative convergence: local row snapped back to the server's.
        let st: String = conn
            .query_row("SELECT status FROM work_orders WHERE id = ?1", [&wo], |r| r.get(0))
            .unwrap();
        assert_eq!(st, "open", "local state converged to the server row");
    }
}

#[tokio::test]
async fn dead_port_classifies_offline_and_burns_no_budget() {
    let Some(env) = e2e_env() else { return };
    let dead_env = Env {
        base_url: "http://127.0.0.1:59999".into(), // nothing listens here
        jwt: env.jwt.clone(),
        vehicle_id: env.vehicle_id,
    };
    let c = device(&dead_env);

    domain::override_set(&c.pool, dead_env.vehicle_id, 123_456, None, seed_user_id())
        .expect("override");
    c.engine.drain().await.expect("drain must not error outward");

    let status = c.engine.status().expect("status");
    assert!(!status.online, "connection refused ⇒ offline");
    assert_eq!(status.pending, 1, "write survives, still queued");
    assert_eq!(status.dead, 0, "offline NEVER dead-letters");
    {
        let conn = c.pool.get().unwrap();
        let item = &outbox::list_active(&conn, 10).unwrap()[0];
        assert_eq!(item.attempts, 0, "offline burns no retry budget");
    }
}
