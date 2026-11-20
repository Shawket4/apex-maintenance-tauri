//! Print the current page on Android.
//!
//! A desktop webview prints with `window.print()`. Android's WebView has no
//! such thing: printing goes through the system PrintManager, fed by the
//! WebView's own print adapter (which lays the page out with its
//! `@media print` rules). This plugin is that one call.
//!
//! `print` answers `true` when the system print screen was opened, `false`
//! on a platform where the page should call `window.print()` itself.

use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
struct Native<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[tauri::command]
async fn print<R: Runtime>(app: AppHandle<R>, title: Option<String>) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let native = app.state::<Native<R>>();
        native
            .0
            .run_mobile_plugin::<serde_json::Value>("print", serde_json::json!({ "title": title }))
            .map_err(|e| e.to_string())?;
        Ok(true)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, title);
        Ok(false)
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("print-sheet")
        .invoke_handler(tauri::generate_handler![print])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("net.apex.printsheet", "PrintPlugin")?;
                _app.manage(Native(handle));
            }
            Ok(())
        })
        .build()
}
