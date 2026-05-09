use crate::AppResult; 
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[tauri::command]
// ⬇️ Right here! This is WHERE 'app' comes from. Tauri injects it automatically.
pub async fn print_pdf(_app: AppHandle, bytes: Vec<u8>) -> AppResult<()> {
    
    // 1. Get the OS-appropriate temp/cache directory
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let temp_dir = _app.path().cache_dir()
        .map_err(|_| crate::AppError::Internal("Failed to get cache dir".into()))?;
        
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let temp_dir = _app.path().app_cache_dir()
        .map_err(|_| crate::AppError::Internal("Failed to get app cache dir".into()))?;

    // 2. Write the file to disk
    let file_path = temp_dir.join(format!("document_{}.pdf", Uuid::new_v4()));
    std::fs::write(&file_path, &bytes)
        .map_err(|e| crate::AppError::Internal(format!("Failed to write PDF: {e}")))?;

    // 3. Print natively!
    #[cfg(target_os = "macos")]
    {
        tracing::info!(path = ?file_path, "Opening PDF for printing via default viewer");
        
        let path_str = file_path.to_string_lossy().to_string();
        tauri_plugin_opener::open_path(path_str, None::<&str>)
            .map_err(|e| crate::AppError::Internal(format!("Failed to open PDF: {e}")))?;
            
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        tracing::info!(path = ?file_path, "Attempting native print via lpr/lp");
        
        // Try lpr first, then lp
        let mut last_err = None;
        for cmd in ["/usr/bin/lpr", "lpr", "/usr/bin/lp", "lp"] {
            match std::process::Command::new(cmd).arg(&file_path).status() {
                Ok(status) if status.success() => return Ok(()),
                Ok(status) => last_err = Some(format!("{} failed: {}", cmd, status)),
                Err(e) => last_err = Some(format!("Failed to run {}: {}", cmd, e)),
            }
        }
        
        return Err(crate::AppError::Internal(
            last_err.unwrap_or_else(|| "No print command found".into())
        ));
    }

    #[cfg(target_os = "windows")]
    {
        tracing::info!(path = ?file_path, "Opening PDF for printing via default viewer");
        
        let path_str = file_path.to_string_lossy().to_string();
        tauri_plugin_opener::open_path(path_str, None::<&str>)
            .map_err(|e| crate::AppError::Internal(format!("Failed to open PDF: {e}")))?;
            
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        // Fallback for other OSs: just open it
        let path_str = file_path.to_string_lossy().to_string();
        tauri_plugin_opener::open_path(path_str, None::<&str>)
            .map_err(|e| crate::AppError::Internal(format!("Failed to open PDF: {e}")))?;
        Ok(())
    }
}
