//! HTTP client wrapping reqwest. Centralised so we have one place that:
//!   - reads the JWT from `<app_data_dir>/session.jwt` and adds Bearer
//!   - maps 401 → `AppError::Unauthorized` for re-login
//!   - logs every request and response

use std::path::PathBuf;
use std::sync::Arc;

use reqwest::{header, Client, Response, StatusCode};
use serde::Serialize;

use crate::{config::AppConfig, session_store, AppError, AppResult};

pub struct RawResponse {
    pub status: StatusCode,
    pub body: String,
}

#[derive(Clone)]
pub struct HttpClient {
    inner: Client,
    config: Arc<AppConfig>,
    data_dir: PathBuf,
}

impl HttpClient {
    pub fn new(config: Arc<AppConfig>, data_dir: PathBuf) -> AppResult<Self> {
        let inner = Client::builder()
            .timeout(config.backend.request_timeout)
            .user_agent(format!("apex-maintenance/{}", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self {
            inner,
            config,
            data_dir,
        })
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

    /// Unauthenticated GET to maint-rust (/health — must work pre-login and
    /// with an expired token: connectivity/version checks never depend on auth).
    pub async fn maint_get_unauth_raw(&self, path: &str) -> AppResult<RawResponse> {
        let url = self.maint_url(path);
        tracing::debug!(%url, "maint GET (unauth)");
        let resp = self.inner.get(&url).send().await?;
        consume_response(&url, resp).await
    }

    /// Unauthenticated POST to maint-rust (login proxy — no JWT yet).
    pub async fn maint_post_unauth_raw<B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> AppResult<RawResponse> {
        let url = self.maint_url(path);
        tracing::debug!(%url, "maint POST (unauth)");
        let resp = self.inner.post(&url).json(body).send().await?;
        consume_response(&url, resp).await
    }

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

    pub async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> AppResult<T> {
        let raw = self.maint_get_raw(path).await?;
        Ok(serde_json::from_str(&raw.body)?)
    }

    pub async fn post<B: Serialize, T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> AppResult<T> {
        let raw = self.maint_post_raw(path, body).await?;
        Ok(serde_json::from_str(&raw.body)?)
    }

    fn require_jwt(&self) -> AppResult<String> {
        session_store::read_jwt(&self.data_dir)?.ok_or(AppError::Unauthorized)
    }

    pub fn base_url(&self) -> &str {
        &self.config.backend.base_url
    }
}

async fn consume_response(url: &str, resp: Response) -> AppResult<RawResponse> {
    let status = resp.status();

    if status == StatusCode::UNAUTHORIZED {
        let body = resp.text().await.unwrap_or_default();
        // Portal guard: only OUR backend's 401 carries the {"error": …}
        // envelope. A captive portal / middlebox answering 401 must classify
        // as Offline — mapping it to auth failure falsely parks the queue and
        // forces a needless re-login on a blip.
        let is_ours = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .map(|v| v.get("error").is_some())
            .unwrap_or(false);
        if is_ours {
            tracing::warn!(%url, %status, body = %truncate(&body, 500), "401 unauthorized");
            return Err(AppError::Unauthorized);
        }
        tracing::warn!(%url, %status, "401 without error envelope (captive portal?)");
        return Err(AppError::Offline("401 without error envelope (captive portal?)".into()));
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
