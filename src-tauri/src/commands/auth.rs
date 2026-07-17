//! Authentication commands.
//!
//! Login flow per architecture §3.1:
//! 1. POST <base>/api/go/api/login  with { email, password }
//! 2. Server returns JSON. Treat the `success` flag as authoritative; the
//!    JWT may be empty initially.
//! 3. JWT and a small UserInfo blob are persisted as mode-0600 files in
//!    Tauri's app-data dir (no OS keychain — unsigned dev builds get
//!    prompted on every read).
//!
//! Error kinds the JS layer needs to distinguish:
//!   - `auth_failed`  → server clearly said "wrong credentials"
//!   - `http`         → connection / 5xx / non-JSON / malformed payload
//!   - `unauthorized` → 401 (used after login for stale tokens)

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::{session_store, AppError, AppResult, AppState};

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: i64,
    pub email: String,
    pub name: String,
    pub permission: i32,
    pub driver_id: i64,
    pub jwt_exp: i64,
}

#[tauri::command]
pub async fn auth_login(
    state: State<'_, AppState>,
    engine: State<'_, crate::commands::sync::EngineState>,
    email: String,
    password: String,
) -> AppResult<UserInfo> {
    let req = LoginRequest {
        email: email.clone(),
        password,
    };

    let resp = state.http.falcon_login_raw("/api/login", &req).await?;

    tracing::debug!(
        email = %email,
        status = %resp.status,
        body_len = resp.body.len(),
        "falcon login response"
    );

    let json: Value = match serde_json::from_str(&resp.body) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, body = %snippet(&resp.body), "login response not JSON");
            return Err(AppError::Http(format!(
                "server returned a non-JSON response: {e}"
            )));
        }
    };

    let success = json
        .get("success")
        .map(|v| {
            if let Some(b) = v.as_bool() {
                b
            } else if let Some(s) = v.as_str() {
                !s.is_empty() && s.to_lowercase() != "false"
            } else {
                false
            }
        })
        .unwrap_or(false);

    if !success {
        let message = json
            .get("message")
            .or_else(|| json.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("wrong email or password")
            .to_string();

        tracing::warn!(
            email = %email,
            success,
            body = %snippet(&resp.body),
            "login rejected by server"
        );

        return Err(AppError::AuthFailed(message));
    }

    let jwt = json.get("jwt").and_then(|v| v.as_str()).unwrap_or("");
    let exp = decode_jwt_exp(jwt).unwrap_or(0);

    let user = UserInfo {
        id: as_i64(&json, "id").unwrap_or(0),
        email: as_string(&json, "email").unwrap_or_else(|| email.clone()),
        name: as_string(&json, "name").unwrap_or_default(),
        permission: as_i64(&json, "permission").unwrap_or(0) as i32,
        driver_id: as_i64(&json, "driver_id").unwrap_or(0),
        jwt_exp: exp,
    };

    session_store::store_jwt(&state.data_dir, jwt)?;

    // A fresh JWT un-parks the sync engine: anything queued while the session
    // was expired drains now instead of waiting for the next heartbeat.
    engine.0.unpark_auth();
    {
        let eng = engine.0.clone();
        tauri::async_runtime::spawn(async move {
            let _ = eng.drain().await;
            let _ = eng.pull().await;
        });
    }
    session_store::store_user_json(&state.data_dir, &serde_json::to_string(&user)?)?;

    tracing::info!(user_id = user.id, email = %user.email, jwt_exp = user.jwt_exp, "login successful");
    Ok(user)
}

#[tauri::command]
pub async fn auth_logout(state: State<'_, AppState>) -> AppResult<()> {
    if let Ok(Some(jwt)) = session_store::read_jwt(&state.data_dir) {
        if !jwt.is_empty() {
            match state
                .http
                .falcon_post_authed_raw("/api/logout", &serde_json::json!({}), &jwt)
                .await
            {
                Ok(r) => tracing::debug!(status = %r.status, "logout returned"),
                Err(e) => tracing::warn!(error = ?e, "logout call failed (continuing)"),
            }
        }
    }

    session_store::delete_jwt(&state.data_dir)?;
    session_store::delete_user_json(&state.data_dir)?;
    tracing::info!("logged out");
    Ok(())
}

#[tauri::command]
pub async fn auth_current_user(state: State<'_, AppState>) -> AppResult<Option<UserInfo>> {
    let Some(json) = session_store::read_user_json(&state.data_dir)? else {
        return Ok(None);
    };
    match serde_json::from_str::<UserInfo>(&json) {
        Ok(user) => Ok(Some(user)),
        Err(e) => {
            tracing::warn!(error = %e, "stale user blob — clearing");
            let _ = session_store::delete_user_json(&state.data_dir);
            let _ = session_store::delete_jwt(&state.data_dir);
            Ok(None)
        }
    }
}

fn as_i64(v: &Value, key: &str) -> Option<i64> {
    v.get(key).and_then(|x| {
        x.as_i64()
            .or_else(|| x.as_u64().map(|u| u as i64))
            .or_else(|| x.as_str().and_then(|s| s.parse::<i64>().ok()))
    })
}

fn as_string(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
}

fn snippet(s: &str) -> &str {
    let max = 500usize;
    if s.len() > max {
        let end = s
            .char_indices()
            .nth(max)
            .map(|(i, _)| i)
            .unwrap_or(s.len());
        &s[..end]
    } else {
        s
    }
}

fn decode_jwt_exp(jwt: &str) -> Option<i64> {
    let mut parts = jwt.split('.');
    let _header = parts.next()?;
    let payload = parts.next()?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    v.get("exp").and_then(|n| n.as_i64())
}
