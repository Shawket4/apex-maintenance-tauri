//! HTTP client wrapping reqwest. Every outbound call is centralised here so
//! we have one place that handles:
//!   - Bearer-JWT injection from the keychain
//!   - 401 → re-login signalling (via `AppError::Unauthorized`)
//!   - timeouts and base-URL resolution from `AppConfig`
//!   - structured logging of every request and response
//!
//! Design note: this layer deliberately does NOT json-decode response bodies.
//! Decoding is the caller's job — they know the expected shape and can produce
//! a much better error than a generic "couldn't decode body". Phase 1's login
//! regression came from putting decode into the transport layer and conflating
//! shape-mismatch with authentication failure.

use std::sync::Arc;

use reqwest::{header, Client, Response, StatusCode};
use serde::Serialize;

use crate::{config::AppConfig, keyring_store, AppError, AppResult};

/// Successful HTTP response body, kept as text so the caller can decide how
/// to parse it (and we can log raw payloads on parse failure).
pub struct RawResponse {
    pub status: StatusCode,
    pub body: String,
}

#[derive(Clone)]
pub struct HttpClient {
    inner: Client,
    config: Arc<AppConfig>,
}

impl HttpClient {
    pub fn new(config: Arc<AppConfig>) -> AppResult<Self> {
        let inner = Client::builder()
            .timeout(config.backend.request_timeout)
            .user_agent(format!("apex-maintenance/{}", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self { inner, config })
    }

    fn falcon_url(&self, path: &str) -> String {
        format!(
            "{}{}{}",
            self.config.backend.base_url, self.config.backend.falcon_prefix, path
        )
    }

    fn maint_url(&self, path: &str) -> String {
        format!(
            "{}{}{}",
            self.config.backend.base_url, self.config.backend.maint_prefix, path
        )
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

    /// GET maint-rust with stored JWT auto-injected. `path` is appended to
    /// the configured maint prefix.
    pub async fn maint_get_raw(&self, path: &str) -> AppResult<RawResponse> {
        let jwt = self.require_jwt()?;
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
        let jwt = self.require_jwt()?;
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

    fn require_jwt(&self) -> AppResult<String> {
        keyring_store::read_jwt(&self.config)?.ok_or(AppError::Unauthorized)
    }

    pub fn base_url(&self) -> &str {
        &self.config.backend.base_url
    }
}

/// Drain the response and return body-as-text. 401 still becomes
/// `AppError::Unauthorized` because that's a transport-level concern (it
/// tells the rest of the app to drop into re-login mode). Every other
/// non-2xx becomes `AppError::Http` carrying status + body snippet.
async fn consume_response(url: &str, resp: Response) -> AppResult<RawResponse> {
    let status = resp.status();

    if status == StatusCode::UNAUTHORIZED {
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
