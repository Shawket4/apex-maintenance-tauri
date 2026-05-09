use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use uuid::Uuid;
use crate::AppResult; // Or however your error handling is set up

#[tauri::command]
pub fn print_pdf(app: AppHandle, bytes: Vec<u8>) -> AppResult<()> {
    // 1. Convert PDF bytes to a Base64 Data URI
    let base64_pdf = STANDARD.encode(&bytes);
    let data_uri = format!("data:application/pdf;base64,{}", base64_pdf);

    // 2. Generate a unique label for the hidden window
    let window_label = format!("print-window-{}", Uuid::new_v4());

    // 3. Create the Tauri v2 WebviewWindow pointing to the PDF
    let print_window = WebviewWindowBuilder::new(
        &app,
        window_label,
        WebviewUrl::External(data_uri.parse().unwrap()),
    )
    .title("Print Document")
    .visible(false) // Keep it hidden
    .build()
    .map_err(|e| crate::AppError::Internal(format!("Failed to create print window: {}", e)))?;

    // 4. Wait for the Webview's PDF engine to load, then trigger native print
    std::thread::spawn(move || {
        // Give the OS webview 1.5 seconds to parse the Base64 PDF
        std::thread::sleep(std::time::Duration::from_millis(1500));
        
        // Use Tauri's native Rust print API
        if let Err(e) = print_window.print() {
            eprintln!("Failed to open print dialog: {}", e);
        }
        
        // Wait for the user to interact with the print dialog, then clean up
        std::thread::sleep(std::time::Duration::from_secs(120));
        let _ = print_window.close();
    });

    Ok(())
}