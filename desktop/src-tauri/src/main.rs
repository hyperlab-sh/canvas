// No console window for the GUI on Windows; `console::attach` brings stdout back for --version and --smoke.
#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

mod config;
mod console;
mod deeplink;
mod download;
mod nav;
mod route;
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

/// Shows `link` (a `canvas://open/<project>/<id>` URL) in the window. When the service is not answering the
/// link is held and the bundled page is shown, which polls and hands over once the service is up.
/// The probe blocks, so it runs off the main thread; navigation goes back through it.
fn handle_deep_link(app: &AppHandle, link: &str) {
    let Some(target) = deeplink::parse(link) else {
        eprintln!("canvas-app: ignoring link {link:?}");
        return;
    };
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let url = deeplink::editor_url(&origin(&state), &target);
        let port = state.port;
        let action = route::after_link(service::probe(port), url);
        let on_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            match action {
                route::LinkAction::Navigate(url) => {
                    if let Err(error) = navigate(&on_main, &url) {
                        eprintln!("canvas-app: cannot open {url}: {error}");
                    }
                }
                route::LinkAction::HoldAndShowBundled(url) => {
                    *on_main.state::<AppState>().pending.lock().unwrap() = Some(url);
                    let on_bundled = main_window(&on_main).and_then(|window| window.url().ok()).is_some_and(|current| nav::is_bundled(&current));
                    if !on_bundled {
                        if let Err(error) = navigate(&on_main, nav::bundled_url().as_str()) {
                            eprintln!("canvas-app: cannot show the service page: {error}");
                        }
                    }
                }
            }
            focus(&on_main);
        });
    });
}

#[tauri::command]
async fn probe(state: State<'_, AppState>) -> Result<serde_json::Value, ()> {
    let port = state.port;
    // Both calls block (a connect and a read timeout, a stat per PATH entry): keep them off the async workers.
    tauri::async_runtime::spawn_blocking(move || {
        serde_json::json!({ "up": service::probe(port), "canStart": service::find_canvas().is_some(), "port": port })
    })
    .await
    .map_err(|_| ())
}

#[tauri::command]
async fn start_service(state: State<'_, AppState>) -> Result<(), String> {
    let port = state.port;
    tauri::async_runtime::spawn_blocking(move || service::start(port)).await.map_err(|error| error.to_string())?
}

/// Leaves the bundled page for the editor (or the diagram a deep link asked for). The held link is
/// released only once the navigation worked, so a failed attempt does not turn into the home page.
#[tauri::command]
async fn open_service(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let url = route::open_url(state.pending.lock().unwrap().as_deref(), &origin(&state));
    navigate(&app, &url)?;
    *state.pending.lock().unwrap() = None;
    Ok(())
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

            let (first, held) = route::start_target(smoke_mode, service_up, cold_link.as_ref(), &origin);
            *app.state::<AppState>().pending.lock().unwrap() = held;
            let start = match first {
                route::Start::Bundled => WebviewUrl::App("index.html".into()),
                route::Start::External(url) => WebviewUrl::External(Url::parse(&url).expect("an origin plus a route")),
            };

            if smoke_mode && !service_up {
                // Nothing to load: report without opening a window onto a dead port.
                println!("{}", smoke::result_line(false, &[format!("no canvas service answering on {origin}")], &format!("{origin}/#/")));
                std::process::exit(1);
            }

            if smoke_mode {
                // The smoke report is the only IPC the service page may use, and only on the service origin.
                app.add_capability(
                    serde_json::json!({
                        "identifier": "smoke",
                        "windows": [WINDOW],
                        "remote": { "urls": [format!("{origin}/*")] },
                        "permissions": ["allow-smoke-report"]
                    })
                    .to_string(),
                )?;
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
    if flag("--version") {
        console::attach();
        println!("canvas-app {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    if flag("--smoke") {
        console::attach();
    }
    run(flag("--smoke"));
}
