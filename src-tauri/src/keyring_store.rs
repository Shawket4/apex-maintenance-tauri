//! Cross-platform JWT persistence via the OS keychain.
//!
//! - macOS:  Keychain
//! - Windows: Credential Manager
//! - Linux:  Secret Service (libsecret)
//!
//! The token is stored under the service "apex_maintenance.jwt" with an
//! account name of "default" so we don't accidentally leak per-user state if
//! we ever support multi-account in the future.

use crate::AppResult;

const SERVICE: &str = "apex_maintenance.jwt";
const ACCOUNT: &str = "default";

const SERVICE_USER: &str = "apex_maintenance.user";

pub fn store_jwt(jwt: &str) -> AppResult<()> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT)?;
    entry.set_password(jwt)?;
    Ok(())
}

pub fn read_jwt() -> AppResult<Option<String>> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT)?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_jwt() -> AppResult<()> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn store_user_json(user_json: &str) -> AppResult<()> {
    let entry = keyring::Entry::new(SERVICE_USER, ACCOUNT)?;
    entry.set_password(user_json)?;
    Ok(())
}

pub fn read_user_json() -> AppResult<Option<String>> {
    let entry = keyring::Entry::new(SERVICE_USER, ACCOUNT)?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_user_json() -> AppResult<()> {
    let entry = keyring::Entry::new(SERVICE_USER, ACCOUNT)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
