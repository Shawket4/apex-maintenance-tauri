const COMMANDS: &[&str] = &["print"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
