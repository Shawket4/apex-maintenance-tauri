//! Cross-platform JWT persistence via the OS keychain.
//!
//! - macOS:  Keychain
//! - Windows: Credential Manager
//! - Linux:  Secret Service (libsecret)
//!
//! Service / account strings come from `AppConfig` so a developer can swap
//! to a different keychain entry for testing without disturbing their real
//! production session.

use crate::{config::AppConfig, AppResult};

pub fn store_jwt(config: &AppConfig, jwt: &str) -> AppResult<()> {
    let entry = keyring::Entry::new(&config.keychain.service_jwt, &config.keychain.account)?;
    entry.set_password(jwt)?;
    Ok(())
}

pub fn read_jwt(config: &AppConfig) -> AppResult<Option<String>> {
    let entry = keyring::Entry::new(&config.keychain.service_jwt, &config.keychain.account)?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_jwt(config: &AppConfig) -> AppResult<()> {
    let entry = keyring::Entry::new(&config.keychain.service_jwt, &config.keychain.account)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn store_user_json(config: &AppConfig, user_json: &str) -> AppResult<()> {
    let entry = keyring::Entry::new(&config.keychain.service_user, &config.keychain.account)?;
    entry.set_password(user_json)?;
    Ok(())
}

pub fn read_user_json(config: &AppConfig) -> AppResult<Option<String>> {
    let entry = keyring::Entry::new(&config.keychain.service_user, &config.keychain.account)?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_user_json(config: &AppConfig) -> AppResult<()> {
    let entry = keyring::Entry::new(&config.keychain.service_user, &config.keychain.account)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
