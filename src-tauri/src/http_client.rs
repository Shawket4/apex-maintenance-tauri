//! HTTP client wrapping reqwest.
//!
//! Every outbound call to `maint-rust` (and the Falcon login passthrough)
//! goes through here so we have one place that handles:
//! - Bearer-JWT injection from the keychain
//! - 401 → re-login signalling (via `AppError::Unauthorized`)
//! - timeouts and base-URL configuration
//! - structured logging of every request and response
//!
//! Design note: this layer deliberately does NOT json-decode the response
//! body. Decoding is the caller's job, because the caller knows the actual
//! response shape and can produce a much better error message than a
//! generic "couldn't decode body". This was the root cause of the Phase 1
//! login regression — every parse failure looked like a 401.

use std::time::Duration;

use reqwest::{header, Client, Response, StatusCode};
use serde::Serialize;

use crate::{keyring_store, AppError, AppResult};

const DEFAULT_BASE: &str = "https://apextransport.ddns.net";
const FALCON_PREFIX: &str = "/api/go";
const MAINT_PREFIX: &str = "/api/maint";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Configurable base URL — Phase 6 will surface this in settings; for now
/// pulled from `APEX_BASE_URL` env var, defaulting to production.
pub fn resolve_base_url() -> String {
    std::env::var("APEX_BASE_URL").unwrap_or_else(|_| DEFAULT_BASE.to_string())
}

/// Successful HTTP response body, kept as text so the caller can decide how
/// to parse it (and we can log raw payloads on parse failure).
pub struct RawResponse {
    pub status: StatusCode,
    pub body: String,
}

#[derive(Clone)]
pub struct HttpClient {
    inner: Client,
    base: String,
}

impl HttpClient {
    pub fn new() -> AppResult<Self> {
        let inner = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .user_agent(format!("apex-maintenance/{}", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self {
            inner,
            base: resolve_base_url(),
        })
    }

    fn falcon_url(&self, path: &str) -> String {
        format!("{}{}{}", self.base, FALCON_PREFIX, path)
    }

    fn maint_url(&self, path: &str) -> String {
        format!("{}{}{}", self.base, MAINT_PREFIX, path)
    }

    /// POST to Falcon login. No auth header.
    pub async fn falcon_login_raw<B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> AppResult<RawResponse> {
        let url = self.falcon_url(path);
        tracing::debug!(%url, "falcon POST");
        let resp = self.inner.post(&url).json(body).send().await?;
        consume_response(&url, resp).await
    }

    /// POST to Falcon with Bearer JWT (used by /api/logout).
    pub async fn falcon_post_authed_raw<B: Serialize>(
        &self,
        path: &str,
        body: &B,
        jwt: &str,
    ) -> AppResult<RawResponse> {
        let url = self.falcon_url(path);
        tracing::debug!(%url, "falcon POST (authed)");
        let resp = self
            .inner
            .post(&url)
            .header(header::AUTHORIZATION, format!("Bearer {jwt}"))
            .json(body)
            .send()
            .await?;
        consume_response(&url, resp).await
    }

    /// GET maint-rust with stored JWT auto-injected.
    pub async fn maint_get_raw(&self, path: &str) -> AppResult<RawResponse> {
        let jwt = require_jwt()?;
        let url = self.maint_url(path);
        tracing::debug!(%url, "maint GET");
        let resp = self
            .inner
            .get(&url)
            .header(header::AUTHORIZATION, format!("Bearer {jwt}"))
            .send()
            .await?;
        consume_response(&url, resp).await
    }

    /// POST maint-rust with stored JWT auto-injected.
    pub async fn maint_post_raw<B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> AppResult<RawResponse> {
        let jwt = require_jwt()?;
        let url = self.maint_url(path);
        tracing::debug!(%url, "maint POST");
        let resp = self
            .inner
            .post(&url)
            .header(header::AUTHORIZATION, format!("Bearer {jwt}"))
            .json(body)
            .send()
            .await?;
        consume_response(&url, resp).await
    }

    pub fn base(&self) -> &str {
        &self.base
    }
}

fn require_jwt() -> AppResult<String> {
    keyring_store::read_jwt()?.ok_or(AppError::Unauthorized)
}

/// Drain the response and return body-as-text, regardless of status.
/// 401 still becomes `AppError::Unauthorized` because that's a transport-level
/// concern (it tells the rest of the app to drop into re-login mode).
/// Every other non-2xx becomes `AppError::Http` carrying status + body snippet.
async fn consume_response(url: &str, resp: Response) -> AppResult<RawResponse> {
    let status = resp.status();

    if status == StatusCode::UNAUTHORIZED {
        // Drain body for logging, but signal Unauthorized to caller.
        let body = resp.text().await.unwrap_or_default();
        tracing::warn!(%url, %status, body = %truncate(&body, 500), "401 unauthorized");
        return Err(AppError::Unauthorized);
    }

    let body = resp.text().await.unwrap_or_default();
    tracing::debug!(%url, %status, body_len = body.len(), "http response");

    if !status.is_success() {
        tracing::warn!(%url, %status, body = %truncate(&body, 500), "non-2xx response");
        return Err(AppError::Http(format!(
            "{} — {}",
            status,
            truncate(&body, 500)
        )));
    }

    Ok(RawResponse { status, body })
}

fn truncate(s: &str, max: usize) -> &str {
    if s.len() > max {
        // char-boundary safe truncation
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