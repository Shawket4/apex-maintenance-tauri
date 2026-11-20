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

    /// The server answered with a non-2xx status. `code`/`message` come from
    /// its `{error, message}` envelope when there is one.
    #[error("{message}")]
    Status { status: u16, code: String, message: String },

    /// A rule the app enforces before writing (stable code for translation).
    #[error("{message}")]
    Rule { code: &'static str, message: String },

    /// Transport-level failure: the NETWORK, not the request. Kept as its own
    /// variant because reqwest 0.12's Display is terse ("error sending
    /// request") — string-sniffing the message misclassified a
    /// connection-refused as transient, which is precisely the mistake that
    /// burns retry budget on offline writes.
    #[error("offline: {0}")]
    Offline(String),

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
        // Chase the source chain so the message stays diagnostic even though
        // reqwest's own Display hides it.
        let mut detail = value.to_string();
        let mut src: Option<&(dyn std::error::Error + 'static)> = std::error::Error::source(&value);
        while let Some(s) = src {
            detail = format!("{detail}: {s}");
            src = std::error::Error::source(s);
        }
        if value.is_connect() || value.is_timeout() || value.is_request() {
            AppError::Offline(detail)
        } else {
            AppError::Http(detail)
        }
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
    /// Stable machine code the UI translates (rule codes, server error codes).
    code: Option<String>,
    message: String,
}

impl AppError {
    pub fn rule(code: &'static str, message: impl Into<String>) -> Self {
        AppError::Rule { code, message: message.into() }
    }

    fn code(&self) -> Option<String> {
        match self {
            AppError::Rule { code, .. } => Some((*code).to_string()),
            AppError::Status { code, .. } if !code.is_empty() => Some(code.clone()),
            _ => None,
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            AppError::Db(_) => "db",
            AppError::Pool(_) => "pool",
            AppError::Http(_) => "http",
            AppError::Status { .. } => "status",
            AppError::Rule { .. } => "rule",
            AppError::Offline(_) => "offline",
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
            code: self.code(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

/// Specta-typed twin of AppError's wire shape. Commands return
/// `CmdResult<T>` so tauri-specta can type the error channel; the JSON the
/// frontend sees is byte-identical to AppError's own serialization.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CmdError {
    pub kind: String,
    pub code: Option<String>,
    pub message: String,
}

impl From<AppError> for CmdError {
    fn from(e: AppError) -> Self {
        CmdError { kind: e.kind().to_string(), code: e.code(), message: e.to_string() }
    }
}

macro_rules! cmd_err_via_app {
    ($($t:ty),+) => {
        $(impl From<$t> for CmdError {
            fn from(e: $t) -> Self {
                AppError::from(e).into()
            }
        })+
    };
}
cmd_err_via_app!(rusqlite::Error, r2d2::Error, serde_json::Error, std::io::Error, reqwest::Error);

pub type CmdResult<T> = Result<T, CmdError>;
