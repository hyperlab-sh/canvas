// No console window for the GUI on Windows; `console::attach` brings stdout back for --version and --smoke.
#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

mod config;
mod console;
mod deeplink;
mod download;
mod dsl;
mod files;
mod http;
mod nav;
mod open_file;
mod route;
mod service;
mod smoke;

use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::webview::DownloadEvent;
use tauri::{AppHandle, DragDropEvent, Manager, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;

const WINDOW: &str = "main";

struct AppState {
    port: u16,
    /// A deep link that arrived while the service was not answering, opened once it is.
    pending: Mutex<Option<String>>,
    /// The file opened (dropped, associated, argv) while the service was not answering; the newest request
    /// replaces any held link and the other way round.
    pending_files: Mutex<Option<PathBuf>>,
    /// Counts link and file requests. A file resolves off the main thread; if the count moved meanwhile a newer
    /// request exists and the older one must not navigate over it.
    requests: AtomicU64,
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
    // The payload of a `#/from/dsl` link is long and carries the user's diagram: log the route only.
    eprintln!("canvas-app: showing {}", url.as_str().split('?').next().unwrap_or_default());
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
    app.state::<AppState>().requests.fetch_add(1, Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let url = deeplink::editor_url(&origin(&state), &target);
        let up = service::probe(state.port);
        let on_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            match route::after_link(up, on_bundled(&on_main), url) {
                route::LinkAction::Navigate(url) => {
                    if let Err(error) = navigate(&on_main, &url) {
                        eprintln!("canvas-app: cannot open {url}: {error}");
                    }
                }
                route::LinkAction::HoldOnly(url) => hold_link(&on_main, url),
                route::LinkAction::HoldAndShowBundled(url) => {
                    hold_link(&on_main, url);
                    if let Err(error) = navigate(&on_main, nav::bundled_url().as_str()) {
                        eprintln!("canvas-app: cannot show the service page: {error}");
                    }
                }
            }
            focus(&on_main);
        });
    });
}

/// Holds a deep link for the hand-over; it supersedes a held file.
fn hold_link(app: &AppHandle, url: String) {
    let state = app.state::<AppState>();
    *state.pending_files.lock().unwrap() = None;
    *state.pending.lock().unwrap() = Some(url);
}

/// Opens the first openable file of `paths` (the OS hands over several only when the user selects several; one
/// window shows one diagram). Resolving can import through the service, so it runs off the main thread.
/// When the service is not answering the file is held and the bundled page is shown, as for a deep link.
fn handle_files(app: &AppHandle, paths: Vec<PathBuf>) {
    let Some(path) = paths.into_iter().next() else { return };
    let ticket = app.state::<AppState>().requests.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let up = service::probe(state.port);
        let resolved = if up { Some(open_file::resolve(&origin(&state), &path, &open_file::Service(state.port))) } else { None };
        let on_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            let state = on_main.state::<AppState>();
            if state.requests.load(Ordering::SeqCst) != ticket {
                eprintln!("canvas-app: not opening {}: a newer request arrived", path.display());
                return;
            }
            match route::after_file(up, on_bundled(&on_main)) {
                route::FileAction::Open => match resolved.expect("resolved while the service answers") {
                    Ok(url) => {
                        *state.pending.lock().unwrap() = None;
                        *state.pending_files.lock().unwrap() = None;
                        if let Err(error) = navigate(&on_main, &url) {
                            eprintln!("canvas-app: cannot open {}: {error}", path.display());
                        }
                    }
                    Err(error) => eprintln!("canvas-app: cannot open {}: {error}", path.display()),
                },
                action => {
                    *state.pending.lock().unwrap() = None;
                    *state.pending_files.lock().unwrap() = Some(path);
                    if action == route::FileAction::HoldAndShowBundled {
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

/// Whether the window currently shows the bundled page.
fn on_bundled(app: &AppHandle) -> bool {
    main_window(app).and_then(|window| window.url().ok()).is_some_and(|current| nav::is_bundled(&current))
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

/// Leaves the bundled page for the editor, the diagram a deep link asked for, or the file that was opened
/// while the service was down. What was held is released only once the navigation worked, so a failed
/// attempt does not turn into the home page.
#[tauri::command]
async fn open_service(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // The page stops polling once this returns, so a request held while the file resolves is served by the
    // next pass of this loop, not by a later call.
    loop {
        if !route::may_hand_over(on_bundled(&app)) {
            return Ok(());
        }
        let held_link = state.pending.lock().unwrap().clone();
        // Taken, so a file that arrives while this one resolves replaces it instead of being overwritten.
        let held_file = state.pending_files.lock().unwrap().take();
        let held_file_back = held_file.clone();
        let (port, home) = (state.port, origin(&state));
        // A link supersedes a held file (as in `hold_link`), so the file taken above is dropped on purpose.
        let url = match (held_link.clone(), held_file) {
            (Some(link), _) => route::open_url(Some(&link), &home),
            (None, Some(file)) => {
                let origin = home.clone();
                let retry = file.clone();
                let resolved = tauri::async_runtime::spawn_blocking(move || open_file::resolve(&origin, &file, &open_file::Service(port)))
                    .await
                    .map_err(|error| error.to_string())?;
                // Resolving awaited: a link or drop that moved the window wins, and one held meanwhile (the
                // service stopped answering) is newer, so it is served instead.
                let (link_held, file_held) = (state.pending.lock().unwrap().is_some(), state.pending_files.lock().unwrap().is_some());
                match route::after_resolve(on_bundled(&app), link_held, file_held) {
                    route::Resolved::Abandon => return Ok(()),
                    route::Resolved::Retry => continue,
                    route::Resolved::Navigate => {}
                }
                resolved.unwrap_or_else(|error| {
                    eprintln!("canvas-app: cannot open {}: {error}", retry.display());
                    home
                })
            }
            (None, None) => home,
        };
        if let Err(error) = navigate(&app, &url) {
            // Keep what was held for the next attempt.
            if held_file_back.is_some() {
                *state.pending_files.lock().unwrap() = held_file_back;
            }
            return Err(error);
        }
        // Release only what this pass served: a link held since is newer. `pending_files` was taken above.
        let mut pending = state.pending.lock().unwrap();
        if *pending == held_link {
            *pending = None;
        }
        return Ok(());
    }
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
        pending_files: Mutex::new(None),
        requests: AtomicU64::new(0),
        smoke: smoke_mode.then(|| smoke::SmokeSender(Mutex::new(report_sender))),
    };

    let mut builder = tauri::Builder::default();
    if !smoke_mode {
        // Registered first (the plugin's rule). With its `deep-link` feature a second launch's link reaches
        // `on_open_url` below, so this callback only brings the window forward and opens files.
        // A second launch's file (an association opens a new process) arrives here as argv.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            focus(app);
            // Relative paths are relative to the second launch's directory, not this process's.
            handle_files(app, files::from_args_in(argv.into_iter().skip(1), std::path::Path::new(&cwd)));
        }));
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
                        // macOS reports opened files here too; `RunEvent::Opened` takes those.
                        if url.scheme() != "file" {
                            handle_deep_link(&for_links, url.as_str());
                        }
                    }
                });
            }

            // Files this process was launched with (an association's argv). Resolved here, before the window
            // exists, so a running service opens straight on the diagram instead of flashing the home page.
            let cold_files = if smoke_mode { Vec::new() } else { files::from_args(std::env::args().skip(1)) };
            let cold_file_url = match cold_files.first() {
                Some(file) if service_up => match open_file::resolve(&origin, file, &open_file::Service(port)) {
                    Ok(url) => Some(url),
                    Err(error) => {
                        eprintln!("canvas-app: cannot open {}: {error}", file.display());
                        None
                    }
                },
                _ => None,
            };

            let (first, held) = route::start_target(smoke_mode, service_up, cold_link.as_ref(), &origin);
            let (first, held) = match cold_file_url {
                Some(url) => (route::Start::External(url), None),
                None => (first, held),
            };
            *app.state::<AppState>().pending.lock().unwrap() = held;
            if !service_up {
                *app.state::<AppState>().pending_files.lock().unwrap() = cold_files.into_iter().next();
            }
            let start = match first {
                route::Start::Bundled => WebviewUrl::App("index.html".into()),
                route::Start::External(url) => {
                    // Same line as `navigate`, so a cold start is as traceable as a warm one (the query carries diagram text).
                    eprintln!("canvas-app: showing {}", url.split('?').next().unwrap_or_default());
                    WebviewUrl::External(Url::parse(&url).expect("an origin plus a route"))
                }
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

            // The native drop handler stays on: the page never sees a dropped file, so WebKit has nothing
            // to navigate to (and `nav::allowed` refuses `file:` anyway).
            let for_drops = handle.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                    handle_files(&for_drops, files::from_paths(paths));
                }
            });

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

    app.run(|app, event| {
        // macOS delivers a double-clicked or `open -a` file as an event, not as argv.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            handle_files(app, files::from_urls(urls.iter()));
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
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
