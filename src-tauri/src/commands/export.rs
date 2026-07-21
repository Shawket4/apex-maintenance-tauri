use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::error::CmdResult;
use crate::services::excel::{ExcelExportConfig, ExcelExporter};

use crate::AppError;

#[tauri::command]
#[specta::specta]
pub async fn export_to_excel(app: AppHandle, config: ExcelExportConfig) -> CmdResult<()> {
    
    // 1. Prompt the user for where to save the file
    let default_name = format!("{}-{}.xlsx", config.filename, chrono::Local::now().format("%Y-%m-%d"));
    
    let file_path = app.dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("Excel Document", &["xlsx"])
        .blocking_save_file();

    if let Some(path) = file_path {
        let disk_path = path.into_path().map_err(|_| AppError::Internal("Invalid path returned".to_string()))?;

        // 2. Generate Excel byte buffer
        let excel_bytes = ExcelExporter::generate(config)?;

        // 3. Save to disk
        std::fs::write(&disk_path, excel_bytes)?;

        // 4. (Optional) Open the file automatically natively
        if let Some(path_str) = disk_path.to_str() {
            let _ = tauri_plugin_opener::open_path(path_str, None::<&str>);
        }
    }

    Ok(())
}