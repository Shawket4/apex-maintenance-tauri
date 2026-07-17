//! END-TO-END: the real engine against the real maint-rust binary.
//!
//! Everything below the HTTP seam is unit-tested; this test exists because the
//! seam is where facades hide — auth headers, envelope shapes, cursor echo,
//! per-op result correlation, conflict payloads.
//!
//! Needs a running maint-rust + a JWT for it, provided via env (the harness
//! script sets these up against a scratch Postgres):
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
use apex_maintenance_lib::services::domain::{
    self, ChassisConfig, RecordInput, TemplateInput, TireInput,
};
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
             VALUES (?1, 'E2E', 100000, '{}', ?2)",
            rusqlite::params![env.vehicle_id, chrono::Utc::now().to_rfc3339()],
        )
        .unwrap();
    }

    let config = Arc::new(AppConfig::load());
    let http = Arc::new(HttpClient::new(config, dir.path().to_path_buf()).expect("http client"));
    let engine = SyncEngine::new(pool.clone(), http);
    Client { pool, engine, _dir: dir }
}

fn seed_user_id() -> i64 {
    77
}

#[tokio::test]
async fn full_offline_day_replays_to_the_real_server() {
    let Some(env) = e2e_env() else { return };
    let c = device(&env);

    // ── work happens "offline": nothing has been pushed yet ────────────────
    let tpl = domain::template_create(
        &c.pool,
        &TemplateInput {
            vehicle_id: env.vehicle_id,
            category_id: "oil_change".into(),
            name_ar: "زيت".into(),
            name_en: "Oil e2e".into(),
            notes_ar: None,
            notes_en: None,
            trigger_type: "mileage".into(),
            interval_km: Some(10_000),
            interval_days: None,
            lead_warn_km: None,
            lead_warn_days: None,
        },
        seed_user_id(),
    )
    .expect("template");

    domain::record_create(
        &c.pool,
        &RecordInput {
            template_id: Some(tpl.clone()),
            vehicle_id: env.vehicle_id,
            category_id: "oil_change".into(),
            performed_at: "2026-07-10T10:00:00Z".into(),
            odometer_at_service: Some(105_000),
            cost: Some(1800.0),
            vendor: Some("e2e vendor".into()),
            performed_by: None,
            notes: None,
        },
        seed_user_id(),
    )
    .expect("record");

    domain::chassis_create(
        &c.pool,
        env.vehicle_id,
        &ChassisConfig { drive_axles: 2, trailer_axles: 4, spares: 2, single_trailer_axles: None },
        seed_user_id(),
    )
    .expect("chassis");

    let tire = domain::tire_create(
        &c.pool,
        &TireInput {
            dot_code: format!("DOT E2E {}", uuid::Uuid::new_v4()),
            brand: "Michelin".into(),
            model: None,
            purchase_date: None,
            purchase_cost: Some(9000.0),
            supplier: None,
            is_retread: None,
            stock_location: None,
            notes: None,
        },
        seed_user_id(),
    )
    .expect("tire");

    let h2lo: String = {
        let conn = c.pool.get().unwrap();
        conn.query_row(
            "SELECT id FROM chassis_positions WHERE position_code = 'H2LO'",
            [],
            |r| r.get(0),
        )
        .unwrap()
    };
    domain::tire_mount(&c.pool, &tire, &h2lo, env.vehicle_id, Some(105_000), "new_install", seed_user_id())
        .expect("mount");

    let before = {
        let conn = c.pool.get().unwrap();
        outbox::counts(&conn).unwrap()
    };
    assert!(before.pending >= 32, "a full day queued locally, got {}", before.pending);

    // ── the network comes back: drain the whole backlog ────────────────────
    c.engine.drain().await.expect("drain");
    let status = c.engine.status().expect("status");
    assert!(status.online, "server reachable ⇒ online");
    assert_eq!(status.pending, 0, "backlog fully drained, {:?}", status.last_error);
    assert_eq!(
        status.dead, 0,
        "no dead letters on a clean replay: {:?}",
        {
            let conn = c.pool.get().unwrap();
            outbox::list_active(&conn, 10)
                .unwrap()
                .into_iter()
                .map(|i| (i.entity_type, i.last_error))
                .collect::<Vec<_>>()
        }
    );

    // Acks adopted the server's sync_version locally.
    {
        let conn = c.pool.get().unwrap();
        let sv: i64 = conn
            .query_row("SELECT sync_version FROM maintenance_templates WHERE id = ?1", [&tpl], |r| r.get(0))
            .unwrap();
        assert!(sv >= 1, "server-assigned version adopted, got {sv}");
    }

    // ── a second device pulls the same world ────────────────────────────────
    let c2 = device(&env);
    let summary = c2.engine.pull().await.expect("pull");
    assert!(summary.errors.is_empty(), "pull errors: {:?}", summary.errors);
    {
        let conn = c2.pool.get().unwrap();
        let tpl_there: i64 = conn
            .query_row("SELECT COUNT(*) FROM maintenance_templates WHERE id = ?1", [&tpl], |r| r.get(0))
            .unwrap();
        assert_eq!(tpl_there, 1, "device 2 received the template");
        let positions: i64 = conn
            .query_row("SELECT COUNT(*) FROM chassis_positions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(positions, 28, "device 2 received the whole chassis");
        let mounted: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tire_assignments WHERE dismounted_at IS NULL AND deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mounted, 1, "device 2 sees the mount");
    }

    // ── stale write → per-op conflict → dead letter carrying the server row ─
    {
        let conn = c.pool.get().unwrap();
        // Fabricate staleness: pretend we never learned the server's version.
        conn.execute(
            "UPDATE maintenance_templates SET sync_version = 0, name_en = 'stale write' WHERE id = ?1",
            [&tpl],
        )
        .unwrap();
    }
    domain::template_update(
        &c.pool,
        &tpl,
        &TemplateInput {
            vehicle_id: env.vehicle_id,
            category_id: "oil_change".into(),
            name_ar: "زيت".into(),
            name_en: "stale write".into(),
            notes_ar: None,
            notes_en: None,
            trigger_type: "mileage".into(),
            interval_km: Some(12_000),
            interval_days: None,
            lead_warn_km: None,
            lead_warn_days: None,
        },
        seed_user_id(),
    )
    .expect("stale update enqueues");
    c.engine.drain().await.expect("drain 2");
    let status = c.engine.status().expect("status 2");
    assert_eq!(status.dead, 1, "stale write dead-letters instead of vanishing");
    {
        let conn = c.pool.get().unwrap();
        let dead = outbox::list_active(&conn, 10).unwrap();
        let d = dead.iter().find(|i| i.status == "dead").expect("dead row present");
        assert!(d.server_row.is_some(), "conflict carries the server row for the user");
        // Server-authoritative convergence: local row snapped back to the server's.
        let name: String = conn
            .query_row("SELECT name_en FROM maintenance_templates WHERE id = ?1", [&tpl], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "Oil e2e", "local state converged to the server row");
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

    domain::override_set(&c.pool, dead_env.vehicle_id, 123_456, None, seed_user_id()).expect("override");
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
