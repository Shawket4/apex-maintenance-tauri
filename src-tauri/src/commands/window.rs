use crate::AppResult; // Adjust to your error handling
use std::process::{Command, Stdio};
use uuid::Uuid;

#[tauri::command]
pub fn print_pdf(bytes: Vec<u8>) -> AppResult<()> {
    
    // 1. Determine safe temporary directory based on OS
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let temp_dir = app.path().cache_dir()
        .map_err(|_| crate::AppError::Internal("Failed to get cache dir".into()))?;
        
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let temp_dir = std::env::temp_dir();

    // 2. Write the PDF to disk safely
    let file_path = temp_dir.join(format!("print_{}.pdf", Uuid::new_v4()));
    std::fs::write(&file_path, &bytes)
        .map_err(|e| crate::AppError::Internal(format!("Failed to write PDF: {e}")))?;

    let path_str = file_path.to_string_lossy().to_string();

    // ==========================================
    // WINDOWS: PowerShell Print Verb
    // ==========================================
    #[cfg(target_os = "windows")]
    {
        Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle", "Hidden",
                "-Command",
                &format!("Start-Process -FilePath '{}' -Verb Print", path_str)
            ])
            // CRITICAL: Detaching standard streams prevents Tauri from infinitely hanging
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| crate::AppError::Internal(format!("Windows print failed: {e}")))?;
    }

    // ==========================================
    // macOS: Preview App Scripting
    // ==========================================
    #[cfg(target_os = "macos")]
    {
        Command::new("osascript")
            .args([
                "-e", &format!("tell application \"Preview\" to open POSIX file \"{}\"", path_str),
                "-e", "tell application \"Preview\" to print document 1 with print dialog"
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| crate::AppError::Internal(format!("macOS print failed: {e}")))?;
    }

    // ==========================================
    // LINUX: LPR Command
    // ==========================================
    #[cfg(target_os = "linux")]
    {
        Command::new("lpr")
            .arg(&path_str)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| crate::AppError::Internal(format!("Linux print failed: {e}")))?;
    }

    // ==========================================
    // MOBILE (Android / iOS): Native System Opener
    // ==========================================
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        tauri_plugin_opener::open_path(path_str, None::<&str>)
            .map_err(|e| crate::AppError::Internal(format!("Mobile open failed: {e}")))?;
    }

    Ok(())
}