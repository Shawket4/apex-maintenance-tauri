//! File-based session storage. Replaces the OS keychain so macOS doesn't
//! prompt for a password on every JWT read in unsigned dev builds.
//!
//! Files live in `<app-data-dir>/<filename>`, mode 0600 on Unix. Tauri's
//! `app_data_dir` is already user-scoped (e.g. `~/Library/Application
//! Support/com.apextransport.maintenance/`), so this is roughly the same
//! protection level as `~/.ssh/id_rsa` or `~/.aws/credentials`.
//!
//! If we ever want OS-keychain-grade security back, we can reintroduce
//! `keyring` behind a feature flag — but it requires code-signing the
//! release build to get the trust grant the OS otherwise asks for.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::AppResult;

const JWT_FILENAME: &str = "session.jwt";
const USER_FILENAME: &str = "session.user.json";

fn jwt_path(data_dir: &Path) -> PathBuf {
    data_dir.join(JWT_FILENAME)
}

fn user_path(data_dir: &Path) -> PathBuf {
    data_dir.join(USER_FILENAME)
}

pub fn store_jwt(data_dir: &Path, jwt: &str) -> AppResult<()> {
    write_secret(&jwt_path(data_dir), jwt.as_bytes())
}

pub fn read_jwt(data_dir: &Path) -> AppResult<Option<String>> {
    read_secret(&jwt_path(data_dir))
}

pub fn delete_jwt(data_dir: &Path) -> AppResult<()> {
    delete_secret(&jwt_path(data_dir))
}

pub fn store_user_json(data_dir: &Path, json: &str) -> AppResult<()> {
    write_secret(&user_path(data_dir), json.as_bytes())
}

pub fn read_user_json(data_dir: &Path) -> AppResult<Option<String>> {
    read_secret(&user_path(data_dir))
}

pub fn delete_user_json(data_dir: &Path) -> AppResult<()> {
    delete_secret(&user_path(data_dir))
}

fn write_secret(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }

    let mut f = opts.open(path)?;
    f.write_all(bytes)?;
    f.sync_all()?;

    // Ensure mode 0600 even when the file pre-existed at a wider mode.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}

fn read_secret(path: &Path) -> AppResult<Option<String>> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn delete_secret(path: &Path) -> AppResult<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}
