//! SQLite pool + migration runner.
//!
//! Migrations are baked into the binary via `include_str!` so the deployable
//! is a single file. Each migration is applied exactly once; applied versions
//! are recorded in `_migrations`.

use std::path::Path;

use r2d2::{Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, Connection, OpenFlags};

use crate::AppResult;

pub type Conn = PooledConnection<SqliteConnectionManager>;

/// Versioned migration. Order matters — lower `version` runs first.
struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "0001_init_schema",
        sql: include_str!("migrations/0001_init_schema.sql"),
    },
    Migration {
        version: 2,
        name: "0002_seeds",
        sql: include_str!("migrations/0002_seeds.sql"),
    },
    Migration {
        version: 3,
        name: "0003_sync_conflicts",
        sql: include_str!("migrations/0003_sync_conflicts.sql"),
    },
];

#[derive(Clone)]
pub struct DbPool {
    inner: Pool<SqliteConnectionManager>,
}

impl DbPool {
    pub fn open(path: &Path) -> AppResult<Self> {
        // ── 1. One-time, single-connection setup ────────────────────────────
        // `PRAGMA journal_mode = WAL` takes an exclusive lock on the DB file
        // while it rewrites the header. If we put it in the per-connection
        // init function, r2d2's eager pool creation races N connections
        // against each other and all-but-one fail with "database is locked".
        // So we set WAL on a standalone connection here, *before* building
        // the pool, and the pool's per-connection init only handles things
        // that are safe to run concurrently.
        {
            let setup = Connection::open_with_flags(
                path,
                OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
            )?;
            // journal_mode is persistent on-disk — once set, future opens
            // already see WAL — but re-setting it is idempotent.
            let mode: String =
                setup.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
            tracing::debug!(journal_mode = %mode, "sqlite journal mode set");
            setup.execute_batch(
                "PRAGMA synchronous   = NORMAL;
                 PRAGMA foreign_keys  = ON;
                 PRAGMA temp_store    = MEMORY;
                 PRAGMA busy_timeout  = 5000;",
            )?;
        }

        // ── 2. Build the pool ───────────────────────────────────────────────
        // Per-connection init is now race-free: none of these pragmas take
        // an exclusive lock.
        let manager = SqliteConnectionManager::file(path).with_init(|c| {
            c.execute_batch(
                "PRAGMA synchronous   = NORMAL;
                 PRAGMA foreign_keys  = ON;
                 PRAGMA temp_store    = MEMORY;
                 PRAGMA busy_timeout  = 5000;",
            )
        });

        let inner = Pool::builder()
            .max_size(8)
            .build(manager)
            .map_err(crate::AppError::Pool)?;

        Ok(Self { inner })
    }

    pub fn get(&self) -> AppResult<Conn> {
        Ok(self.inner.get()?)
    }

    /// Apply every pending migration inside a single transaction each.
    pub fn run_migrations(&self) -> AppResult<()> {
        let mut conn = self.get()?;

        // Bookkeeping table.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
                version    INTEGER PRIMARY KEY,
                name       TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );",
        )?;

        for m in MIGRATIONS {
            let applied: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM _migrations WHERE version = ?1)",
                    params![m.version],
                    |row| row.get::<_, i64>(0).map(|v| v != 0),
                )
                .unwrap_or(false);

            if applied {
                tracing::debug!(version = m.version, name = m.name, "migration already applied");
                continue;
            }

            tracing::info!(version = m.version, name = m.name, "applying migration");
            let tx = conn.transaction()?;
            tx.execute_batch(m.sql)?;
            tx.execute(
                "INSERT INTO _migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
                params![
                    m.version,
                    m.name,
                    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
                ],
            )?;
            tx.commit()?;
        }

        Ok(())
    }

    /// Quick liveness check: SELECT 1 + count migrations applied.
    pub fn health(&self) -> AppResult<DbHealth> {
        let conn = self.get()?;
        let migrations_applied: i64 =
            conn.query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0))?;
        let outbox_pending: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sync_outbox WHERE attempts < 5",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let categories: i64 = conn
            .query_row("SELECT COUNT(*) FROM maintenance_categories", [], |r| {
                r.get(0)
            })
            .unwrap_or(0);

        Ok(DbHealth {
            ok: true,
            migrations_applied,
            outbox_pending,
            seeded_categories: categories,
        })
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DbHealth {
    pub ok: bool,
    pub migrations_applied: i64,
    pub outbox_pending: i64,
    pub seeded_categories: i64,
}
