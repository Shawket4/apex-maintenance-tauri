use serde::Serialize;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("connection pool error: {0}")]
    Pool(#[from] r2d2::Error),

    #[error("http error: {0}")]
    Http(String),

    #[error("authentication failed: {0}")]
    AuthFailed(String),

    #[error("unauthorized — please log in again")]
    Unauthorized,

    #[error("keyring error: {0}")]
    Keyring(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("internal error: {0}")]
    Internal(String),
}

impl From<reqwest::Error> for AppError {
    fn from(value: reqwest::Error) -> Self {
        AppError::Http(value.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(value: keyring::Error) -> Self {
        AppError::Keyring(value.to_string())
    }
}

/// Tauri serialises errors via `serde::Serialize`. Marshall to a small struct
/// so the JS side gets `{ kind, message }` in every failure path.
#[derive(Serialize)]
struct WireError {
    kind: &'static str,
    message: String,
}

impl AppError {
    fn kind(&self) -> &'static str {
        match self {
            AppError::Db(_) => "db",
            AppError::Pool(_) => "pool",
            AppError::Http(_) => "http",
            AppError::AuthFailed(_) => "auth_failed",
            AppError::Unauthorized => "unauthorized",
            AppError::Keyring(_) => "keyring",
            AppError::Io(_) => "io",
            AppError::Serde(_) => "serde",
            AppError::Internal(_) => "internal",
        }
    }
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        WireError {
            kind: self.kind(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}
