// No console window for the GUI on Windows; `console::attach` brings stdout back for --version and --smoke.
#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

mod config;
mod console;
mod deeplink;
mod download;
mod nav;
mod service;
mod smoke;

use std::sync::mpsc::channel;
use std::sync::Mutex;

use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Manager, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;

const WINDOW: &str = "main";

struct AppState {
    port: u16,
    /// A deep link that arrived while the service was not answering, opened once it is.
    pending: Mutex<Option<String>>,
    /// Set in `--smoke` mode only.
    smoke: Option<smoke::SmokeSender>,
}

fn origin(state: &AppState) -> String {
    config::service_origin(state.port)
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW)
}

fn focus(app: &AppHandle) {
    if let Some(window) = main_window(app) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn navigate(app: &AppHandle, url: &str) -> Result<(), String> {
    let url = Url::parse(url).map_err(|error| error.to_string())?;
    main_window(app).ok_or("the window is gone")?.navigate(url).map_err(|error| error.to_string())
}

/// Shows `link` (a `canvas://open/<project>/<id>` URL) in the window, or holds it until the service answers.
fn handle_deep_link(app: &AppHandle, link: &str) {
    let Some(target) = deeplink::parse(link) else {
        eprintln!("canvas-app: ignoring link {link:?}");
        return;
    };
    let state = app.state::<AppState>();
    let url = deeplink::editor_url(&origin(&state), &target);
    if service::probe(state.port) {
        if let Err(error) = navigate(app, &url) {
            eprintln!("canvas-app: cannot open {url}: {error}");
        }
    } else {
        *state.pending.lock().unwrap() = Some(url);
    }
    focus(app);
}

#[tauri::command]
async fn probe(state: State<'_, AppState>) -> Result<serde_json::Value, ()> {
    Ok(serde_json::json!({
        "up": service::probe(state.port),
        "canStart": service::find_canvas().is_some(),
        "port": state.port,
    }))
}

#[tauri::command]
async fn start_service(state: State<'_, AppState>) -> Result<(), String> {
    service::start(state.port)
}

/// Leaves the bundled page for the editor (or the diagram a deep link asked for).
#[tauri::command]
async fn open_service(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let url = state.pending.lock().unwrap().take().unwrap_or_else(|| origin(&state));
    navigate(&app, &url)
}

#[tauri::command]
fn smoke_report(state: State<'_, AppState>, mounted: bool, errors: Vec<String>, url: String) {
    if let Some(smoke) = &state.smoke {
        let _ = smoke.0.lock().unwrap().send(smoke::Report { mounted, errors, url });
    }
}

fn run(smoke_mode: bool) {
    let (report_sender, reports) = channel();
    let port = config::port();
    let state = AppState {
        port,
        pending: Mutex::new(None),
        smoke: smoke_mode.then(|| smoke::SmokeSender(Mutex::new(report_sender))),
    };

    let mut builder = tauri::Builder::default();
    if !smoke_mode {
        // Registered first (the plugin's rule). With its `deep-link` feature a second launch's link reaches
        // `on_open_url` below, so this callback only brings the window forward.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| focus(app)));
    }
    let app = builder
        .plugin(tauri_plugin_deep_link::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![probe, start_service, open_service, smoke_report])
        .setup(move |app| {
            let handle = app.handle().clone();
            let service_up = service::probe(port);
            let origin = config::service_origin(port);

            // Unpackaged runs (cargo run, AppImage) have no installer to register the scheme.
            #[cfg(any(windows, target_os = "linux"))]
            if cfg!(debug_assertions) || std::env::var_os("APPIMAGE").is_some() {
                let _ = app.deep_link().register_all();
            }

            let cold_link = app
                .deep_link()
                .get_current()
                .ok()
                .flatten()
                .and_then(|urls| urls.iter().find_map(|url| deeplink::parse(url.as_str())));
            if !smoke_mode {
                let for_links = handle.clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        handle_deep_link(&for_links, url.as_str());
                    }
                });
            }

            let start = if smoke_mode {
                WebviewUrl::External(Url::parse(&format!("{origin}/#/")).unwrap())
            } else if service_up {
                let url = cold_link.as_ref().map_or_else(|| format!("{origin}/"), |target| deeplink::editor_url(&origin, target));
                WebviewUrl::External(Url::parse(&url).unwrap())
            } else {
                if let Some(target) = &cold_link {
                    *app.state::<AppState>().pending.lock().unwrap() = Some(deeplink::editor_url(&origin, target));
                }
                WebviewUrl::App("index.html".into())
            };

            if smoke_mode && !service_up {
                // Nothing to load: report without opening a window onto a dead port.
                println!("{}", smoke::result_line(false, &[format!("no canvas service answering on {origin}")], &format!("{origin}/#/")));
                std::process::exit(1);
            }

            let downloads = download::downloads_path(app.path().download_dir().ok());
            let mut window = WebviewWindowBuilder::new(app, WINDOW, start)
                .title("Canvas")
                .inner_size(1280.0, 800.0)
                .on_navigation(move |url| {
                    let allowed = nav::allowed(url, port);
                    if !allowed {
                        eprintln!("canvas-app: refused to navigate to {url}");
                    }
                    allowed
                })
                .on_download(move |_webview, event| {
                    match event {
                        DownloadEvent::Requested { destination, .. } => {
                            if let Some(dir) = &downloads {
                                // A missing folder (a fresh Linux profile) is created on the first download.
                                let _ = std::fs::create_dir_all(dir);
                                *destination = download::destination(dir, destination, |path| path.exists());
                            }
                            eprintln!("canvas-app: saving download to {}", destination.display());
                        }
                        DownloadEvent::Finished { path, success, .. } => {
                            eprintln!("canvas-app: download finished (success: {success}): {path:?}");
                        }
                        _ => {}
                    }
                    true
                });
            if smoke_mode {
                window = window.initialization_script(smoke::SCRIPT);
            }
            let window = window.build()?;
            let _ = window.show();

            if smoke_mode {
                let page = format!("{origin}/#/");
                std::thread::spawn(move || {
                    let (line, code) = smoke::wait(&reports, smoke::MOUNT_TIMEOUT, &page);
                    println!("{line}");
                    std::process::exit(code);
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Canvas");

    app.run(|_, _| {});
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flag = |name: &str| args.iter().any(|arg| arg == name);
    if flag("--version") || flag("-V") {
        console::attach();
        println!("canvas-app {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    if flag("--smoke") {
        console::attach();
    }
    run(flag("--smoke"));
}
