use tauri::WebviewWindow;

#[tauri::command]
pub fn print_window(window: WebviewWindow) {
    let _ = window.print();
}
