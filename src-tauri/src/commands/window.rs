use crate::AppResult; 
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[tauri::command]
// ⬇️ Right here! This is WHERE 'app' comes from. Tauri injects it automatically.
pub fn print_pdf(app: AppHandle, bytes: Vec<u8>) -> AppResult<()> {
    
    // 1. Get the OS-appropriate temp/cache directory
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let temp_dir = app.path().cache_dir()
        .map_err(|_| crate::AppError::Internal("Failed to get cache dir".into()))?;
        
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let temp_dir = std::env::temp_dir();

    // 2. Write the file to disk
    let file_path = temp_dir.join(format!("document_{}.pdf", Uuid::new_v4()));
    std::fs::write(&file_path, &bytes)
        .map_err(|e| crate::AppError::Internal(format!("Failed to write PDF: {e}")))?;

    // 3. Just ask the OS to open it natively!
    let path_str = file_path.to_string_lossy().to_string();
    tauri_plugin_opener::open_path(path_str, None::<&str>)
        .map_err(|e| crate::AppError::Internal(format!("Failed to open PDF: {e}")))?;

    Ok(())
}