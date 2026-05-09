//! Application configuration.
//!
//! All tunables come from the environment. In dev `.env` is loaded by `dotenvy`
//! at startup; in production the OS env wins. Defaults are baked in here so a
//! freshly cloned repo runs without a `.env` file at all.

use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub backend: BackendConfig,
    pub cache: CacheConfig,
    pub sync: SyncConfig,
    pub storage: StorageConfig,
}

#[derive(Debug, Clone)]
pub struct BackendConfig {
    pub base_url: String,
    pub falcon_prefix: String,
    pub maint_prefix: String,
    pub request_timeout: Duration,
}

#[derive(Debug, Clone)]
pub struct CacheConfig {
    pub vehicles_refresh_interval: Duration,
    pub vehicles_ttl: Duration,
    pub invoices_refresh_interval: Duration,
    pub invoices_ttl: Duration,
    pub invoices_page_size: u32,
}

#[derive(Debug, Clone)]
pub struct SyncConfig {
    pub push_interval: Duration,
    pub pull_interval: Duration,
    pub push_batch_size: u32,
    pub pull_limit: u32,
}

#[derive(Debug, Clone)]
pub struct StorageConfig {
    /// Filename only — Tauri provides the directory.
    pub db_filename: String,
}

impl AppConfig {
    pub fn load() -> Self {
        if let Err(e) = dotenvy::dotenv() {
            tracing::trace!(?e, ".env not loaded");
        } else {
            tracing::debug!(".env loaded");
        }

        let cfg = AppConfig {
            backend: BackendConfig {
                base_url: env_or("APEX_BASE_URL", "https://apextransport.ddns.net"),
                falcon_prefix: env_or("APEX_FALCON_PREFIX", "/api/go"),
                maint_prefix: env_or("APEX_MAINT_PREFIX", "/api/maint"),
                request_timeout: Duration::from_secs(env_u64("APEX_REQUEST_TIMEOUT_SECS", 30)),
            },
            cache: CacheConfig {
                vehicles_refresh_interval: Duration::from_secs(env_u64(
                    "APEX_CACHE_VEHICLES_REFRESH_INTERVAL_SECS",
                    60,
                )),
                vehicles_ttl: Duration::from_secs(env_u64(
                    "APEX_CACHE_VEHICLES_TTL_SECS",
                    300,
                )),
                invoices_refresh_interval: Duration::from_secs(env_u64(
                    "APEX_CACHE_INVOICES_REFRESH_INTERVAL_SECS",
                    300,
                )),
                invoices_ttl: Duration::from_secs(env_u64(
                    "APEX_CACHE_INVOICES_TTL_SECS",
                    900,
                )),
                invoices_page_size: env_u32("APEX_CACHE_INVOICES_PAGE_SIZE", 100),
            },
            sync: SyncConfig {
                push_interval: Duration::from_secs(env_u64("APEX_SYNC_PUSH_INTERVAL_SECS", 30)),
                pull_interval: Duration::from_secs(env_u64("APEX_SYNC_PULL_INTERVAL_SECS", 60)),
                push_batch_size: env_u32("APEX_SYNC_PUSH_BATCH_SIZE", 50),
                pull_limit: env_u32("APEX_SYNC_PULL_LIMIT", 200),
            },
            storage: StorageConfig {
                db_filename: env_or("APEX_DB_FILENAME", "apex_maintenance.db"),
            },
        };

        tracing::info!(
            base_url = %cfg.backend.base_url,
            db = %cfg.storage.db_filename,
            "config loaded"
        );

        cfg
    }

    pub fn db_path(&self, app_data_dir: &std::path::Path) -> PathBuf {
        app_data_dir.join(&self.storage.db_filename)
    }
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| default.to_string())
}

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(default)
}

fn env_u32(key: &str, default: u32) -> u32 {
    std::env::var(key)
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(default)
}
