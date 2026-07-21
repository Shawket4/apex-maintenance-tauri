use crate::error::CmdResult;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

/// Write a rendered PDF to the app cache dir and hand it to the OS print
/// path: macOS/Windows open the default viewer; Linux tries lpr/lp directly.
#[tauri::command]
#[specta::specta]
pub async fn print_pdf(app: AppHandle, bytes: Vec<u8>) -> CmdResult<()> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let temp_dir = app
        .path()
        .cache_dir()
        .map_err(|_| crate::AppError::Internal("Failed to get cache dir".into()))?;

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let temp_dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| crate::AppError::Internal("Failed to get app cache dir".into()))?;

    let file_path = temp_dir.join(format!("document_{}.pdf", Uuid::new_v4()));
    std::fs::write(&file_path, &bytes)
        .map_err(|e| crate::AppError::Internal(format!("Failed to write PDF: {e}")))?;

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        tracing::info!(path = ?file_path, "opening PDF for printing via default viewer");
        let path_str = file_path.to_string_lossy().to_string();
        tauri_plugin_opener::open_path(path_str, None::<&str>)
            .map_err(|e| crate::AppError::Internal(format!("Failed to open PDF: {e}")))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        tracing::info!(path = ?file_path, "attempting native print via lpr/lp");
        let mut last_err = None;
        for cmd in ["/usr/bin/lpr", "lpr", "/usr/bin/lp", "lp"] {
            match std::process::Command::new(cmd).arg(&file_path).status() {
                Ok(status) if status.success() => return Ok(()),
                Ok(status) => last_err = Some(format!("{cmd} failed: {status}")),
                Err(e) => last_err = Some(format!("Failed to run {cmd}: {e}")),
            }
        }
        return Err(crate::AppError::Internal(
            last_err.unwrap_or_else(|| "No print command found".into()),
        )
        .into());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let path_str = file_path.to_string_lossy().to_string();
        tauri_plugin_opener::open_path(path_str, None::<&str>)
            .map_err(|e| crate::AppError::Internal(format!("Failed to open PDF: {e}")))?;
        Ok(())
    }
}
