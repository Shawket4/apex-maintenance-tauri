use crate::AppResult;
use std::process::Command;
use uuid::Uuid;

#[tauri::command]
pub fn print_pdf(bytes: Vec<u8>) -> AppResult<()> {
    let filename = format!("print_{}.pdf", Uuid::new_v4());
    let tmp_dir = std::env::temp_dir();
    let path = tmp_dir.join(&filename);

    std::fs::write(&path, &bytes)
        .map_err(|e| crate::AppError::Internal(format!("Failed to write PDF: {e}")))?;

    let path_str = path.to_string_lossy().to_string();

    // Trigger native print dialog — branch per platform
    let result = match std::env::consts::OS {
        "macos"   => Command::new("osascript")
            .args([
                "-e", &format!("tell application \"Preview\" to open POSIX file \"{}\"", path_str),
                "-e", "tell application \"Preview\" to print document 1 with print dialog"
            ])
            .spawn(),
        "windows" => Command::new("powershell")
            .args([
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-Command",
                &format!("Start-Process -FilePath \"{}\" -Verb Print", path_str)
            ])
            .spawn(),
        _ => Command::new("lpr").arg(&path_str).spawn(),
    };

    result.map_err(|e| crate::AppError::Internal(format!("Failed to trigger print dialog: {e}")))?;

    Ok(())
}
