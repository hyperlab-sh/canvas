fn main() {
    // Commands the windows may call; each gets an `allow-<name>` permission for the capabilities.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["probe", "start_service", "open_service", "smoke_report"]),
        ),
    )
    .expect("failed to run tauri-build");
}
