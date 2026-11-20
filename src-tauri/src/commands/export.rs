use std::io::Write;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::{FsExt, OpenOptions};

use crate::error::CmdResult;
use crate::services::excel::{ExcelExportConfig, ExcelExporter};
use crate::AppError;

/// Ask where to save, then write the workbook there. Returns false when the
/// person closed the save dialog without choosing.
///
/// The destination goes through the file-system plugin, not `std::fs`: on
/// Android the system picker answers with a content:// address, which is not
/// a path, and only the plugin can open it.
#[tauri::command]
#[specta::specta]
pub async fn export_to_excel(app: AppHandle, config: ExcelExportConfig) -> CmdResult<bool> {
    let default_name = format!("{}-{}.xlsx", config.filename, chrono::Local::now().format("%Y-%m-%d"));
    let bytes = ExcelExporter::generate(config)?;

    let Some(target) = app.dialog().file().set_file_name(&default_name).add_filter("Excel Document", &["xlsx"]).blocking_save_file()
    else {
        return Ok(false);
    };

    let mut opts = OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    let mut file = app
        .fs()
        .open(target.clone(), opts)
        .map_err(|e| AppError::Internal(format!("could not open the chosen file: {e}")))?;
    file.write_all(&bytes)?;
    file.flush()?;
    drop(file);

    // On a computer, open it straight away. (A phone shows it in Downloads /
    // Files; there is no path to hand to another app.)
    #[cfg(desktop)]
    if let Ok(path) = target.into_path() {
        if let Some(p) = path.to_str() {
            let _ = tauri_plugin_opener::open_path(p, None::<&str>);
        }
    }
    Ok(true)
}
