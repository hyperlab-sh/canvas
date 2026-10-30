//! Talking to the service: is it answering, and (only on the user's explicit action) starting it.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(2);

/// Whether `raw` (a full HTTP response to `GET /health`) is the canvas service saying it is up.
/// The body is located by its braces so chunked transfer framing does not matter.
pub fn is_service_response(raw: &str) -> bool {
    let Some(status) = raw.lines().next() else { return false };
    let mut fields = status.split_whitespace();
    if !fields.next().is_some_and(|version| version.starts_with("HTTP/1.")) || fields.next() != Some("200") {
        return false;
    }
    let Some(body) = raw.split_once("\r\n\r\n").map(|(_, body)| body) else { return false };
    let (Some(start), Some(end)) = (body.find('{'), body.rfind('}')) else { return false };
    serde_json::from_str::<serde_json::Value>(&body[start..=end])
        .map(|json| json.get("service").and_then(|service| service.as_str()) == Some("openflowkit-service"))
        .unwrap_or(false)
}

/// `GET http://127.0.0.1:<port>/health` over a plain socket (no HTTP client needed for one fixed request).
pub fn probe(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, TIMEOUT) else { return false };
    let _ = stream.set_read_timeout(Some(TIMEOUT));
    let _ = stream.set_write_timeout(Some(TIMEOUT));
    let request = format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut raw = Vec::new();
    let _ = stream.take(64 * 1024).read_to_end(&mut raw);
    is_service_response(&String::from_utf8_lossy(&raw))
}

/// First `name` (with each `PATHEXT` suffix on Windows) in the `path_var` directories for which `is_file` holds.
pub fn find_on_path(name: &str, path_var: &std::ffi::OsStr, extensions: &[String], is_file: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    std::env::split_paths(path_var).find_map(|dir| {
        std::iter::once(String::new())
            .chain(extensions.iter().cloned())
            .map(|extension| dir.join(format!("{name}{extension}")))
            .find(|candidate| is_file(candidate))
    })
}

/// Directories to try after PATH. A Finder/Dock launch on macOS gets only `/usr/bin:/bin:/usr/sbin:/sbin`,
/// so the usual install locations are listed; no shell is spawned to learn the user's real PATH.
pub fn fallback_dirs(home: Option<&Path>, local_app_data: Option<&Path>, app_data: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = vec!["/opt/homebrew/bin".into(), "/usr/local/bin".into()];
    if let Some(home) = home {
        dirs.extend([".bun/bin", ".local/bin", ".npm-global/bin"].map(|dir| home.join(dir)));
    }
    if let Some(local) = local_app_data {
        dirs.push(local.join("Programs"));
    }
    if let Some(roaming) = app_data {
        dirs.push(roaming.join("npm"));
    }
    dirs
}

/// A regular file that can be run (on Unix: some execute bit set).
pub fn is_runnable(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else { return false };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return metadata.permissions().mode() & 0o111 != 0;
    }
    #[cfg(not(unix))]
    true
}

/// `canvas` on PATH, else in the well-known install directories.
pub fn find_canvas() -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|path| std::env::split_paths(&path).collect()).unwrap_or_default();
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from);
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let roaming = std::env::var_os("APPDATA").map(PathBuf::from);
    dirs.extend(fallback_dirs(home.as_deref(), local.as_deref(), roaming.as_deref()));
    let extensions: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .filter(|extension| !extension.is_empty())
            .map(str::to_ascii_lowercase)
            .collect()
    } else {
        Vec::new()
    };
    find_on_path("canvas", &std::env::join_paths(dirs).ok()?, &extensions, is_runnable)
}

/// Starts `canvas serve --port <port>` detached; the service outlives the app. This is the only place
/// the app spawns a process, and it runs only when the user presses "Start service".
pub fn start(port: u16) -> Result<(), String> {
    let canvas = find_canvas().ok_or("`canvas` is not on your PATH. Install it from the Canvas README, then try again.")?;
    let mut command = Command::new(canvas);
    command.args(["serve", "--port", &port.to_string()]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|error| format!("Could not start `canvas serve`: {error}"))?;
    // Reap it if it exits (a failed start), without holding the app up.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::net::TcpListener;

    const HEALTH: &str = r#"{"ok":true,"service":"openflowkit-service","version":"0.3.0","port":43120,"projects":["scratch"],"pid":1}"#;

    fn response(status: &str, body: &str) -> String {
        format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }

    #[test]
    fn recognises_the_service() {
        assert!(is_service_response(&response("200 OK", HEALTH)));
    }

    #[test]
    fn recognises_a_chunked_body() {
        let raw = format!("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{HEALTH}\r\n0\r\n\r\n", HEALTH.len());
        assert!(is_service_response(&raw));
    }

    #[test]
    fn rejects_other_things_on_the_port() {
        for raw in [
            String::new(),
            "garbage".into(),
            response("404 Not Found", HEALTH),
            response("500 Internal Server Error", HEALTH),
            response("200 OK", ""),
            response("200 OK", "not json"),
            response("200 OK", r#"{"ok":true}"#),
            response("200 OK", r#"{"service":"something-else"}"#),
            response("200 OK", r#"{"service":42}"#),
            "HTTP/1.1 200 OK\r\nno body separator".into(),
            "FTP/1.1 200 OK\r\n\r\n{\"service\":\"openflowkit-service\"}".into(),
        ] {
            assert!(!is_service_response(&raw), "{raw:?}");
        }
    }

    /// A listener that answers one request with `reply`, on an OS-assigned port.
    fn serve_once(reply: String) -> (u16, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let read = stream.read(&mut request).unwrap();
            stream.write_all(reply.as_bytes()).unwrap();
            String::from_utf8_lossy(&request[..read]).into_owned()
        });
        (port, handle)
    }

    #[test]
    fn probe_sees_a_running_service_and_asks_for_health() {
        let (port, server) = serve_once(response("200 OK", HEALTH));
        assert!(probe(port));
        let request = server.join().unwrap();
        assert!(request.starts_with("GET /health HTTP/1.1\r\n"), "{request:?}");
        assert!(request.contains(&format!("Host: 127.0.0.1:{port}")), "{request:?}");
    }

    #[test]
    fn probe_rejects_a_foreign_server() {
        let (port, server) = serve_once(response("200 OK", "<html>hello</html>"));
        assert!(!probe(port));
        server.join().unwrap();
    }

    #[test]
    fn probe_is_false_when_nothing_listens() {
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert!(!probe(port));
    }

    fn path_of(dirs: &[&str]) -> OsString {
        std::env::join_paths(dirs).unwrap()
    }

    #[test]
    fn finds_the_first_match_on_path() {
        let found = find_on_path("canvas", &path_of(&["/a", "/b", "/c"]), &[], |p| p == Path::new("/b/canvas") || p == Path::new("/c/canvas"));
        assert_eq!(found, Some(PathBuf::from("/b/canvas")));
    }

    #[test]
    fn fallback_dirs_come_in_a_fixed_order() {
        let dirs = fallback_dirs(Some(Path::new("/h")), Some(Path::new("C:/L")), Some(Path::new("C:/R")));
        let expected: Vec<PathBuf> = ["/opt/homebrew/bin", "/usr/local/bin", "/h/.bun/bin", "/h/.local/bin", "/h/.npm-global/bin", "C:/L/Programs", "C:/R/npm"].map(PathBuf::from).to_vec();
        assert_eq!(dirs, expected);
        assert_eq!(fallback_dirs(None, None, None), vec![PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")]);
    }

    #[test]
    fn path_comes_before_the_fallbacks() {
        let path = std::env::join_paths(["/first", "/opt/homebrew/bin"]).unwrap();
        let found = find_on_path("canvas", &path, &[], |p| p == Path::new("/first/canvas") || p == Path::new("/opt/homebrew/bin/canvas"));
        assert_eq!(found, Some(PathBuf::from("/first/canvas")));
    }

    #[cfg(unix)]
    #[test]
    fn only_executable_regular_files_count() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("canvas");
        std::fs::write(&file, b"#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!is_runnable(&file));
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(is_runnable(&file));
        assert!(!is_runnable(dir.path()));
        assert!(!is_runnable(&dir.path().join("missing")));
    }

    #[test]
    fn finds_nothing_when_absent() {
        assert_eq!(find_on_path("canvas", &path_of(&["/a", "/b"]), &[], |_| false), None);
    }

    #[test]
    fn tries_each_extension_per_directory_in_order() {
        let extensions = vec![".exe".to_string(), ".cmd".to_string()];
        let found = find_on_path("canvas", &path_of(&["/a", "/b"]), &extensions, |p| p == Path::new("/a/canvas.cmd") || p == Path::new("/b/canvas.exe"));
        assert_eq!(found, Some(PathBuf::from("/a/canvas.cmd")));
    }
}
