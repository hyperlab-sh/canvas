//! The navigation guard: the window may only show the bundled page or the service on loopback.
//!
//! `localhost` is refused on purpose: it may resolve to `::1` or to another host entry, and the IPC
//! capability and the service's Host check are written for `127.0.0.1` only. Everything else (other ports,
//! https, file:, other hosts, userinfo tricks) is refused too. `blob:` URLs are allowed only when they were
//! minted by the service origin: the editor's exports are `<a download href="blob:...">` navigations.

use tauri::Url;

/// Whether the window may navigate to `url` when the service listens on `port`.
pub fn allowed(url: &Url, port: u16) -> bool {
    match url.scheme() {
        // The bundled page: `tauri://localhost` (macOS, Linux) or `http(s)://tauri.localhost` (Windows).
        "tauri" => url.host_str() == Some("localhost"),
        "http" if url.host_str() == Some("tauri.localhost") => true,
        "https" if url.host_str() == Some("tauri.localhost") => true,
        "http" => {
            url.host_str() == Some("127.0.0.1")
                && url.port_or_known_default() == Some(port)
                && url.username().is_empty()
                && url.password().is_none()
        }
        // Object URLs the service's own page created (exports are `<a download href="blob:...">`).
        "blob" => Url::parse(url.path()).is_ok_and(|inner| inner.scheme() == "http" && allowed(&inner, port)),
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(url: &str, port: u16) -> bool {
        allowed(&Url::parse(url).expect(url), port)
    }

    #[test]
    fn the_service_origin_is_allowed() {
        assert!(ok("http://127.0.0.1:43120/", 43120));
        assert!(ok("http://127.0.0.1:43120/#/p/scratch/abc", 43120));
        assert!(ok("http://127.0.0.1:43120/d/doc-1?x=1", 43120));
        assert!(ok("http://127.0.0.1:5000/", 5000));
    }

    #[test]
    fn the_bundled_page_is_allowed() {
        assert!(ok("tauri://localhost/", 43120));
        assert!(ok("tauri://localhost/index.html", 43120));
        assert!(ok("http://tauri.localhost/", 43120));
        assert!(ok("https://tauri.localhost/index.html", 43120));
        assert!(ok("about:blank", 43120));
    }

    #[test]
    fn other_hosts_are_refused() {
        assert!(!ok("http://example.com", 43120));
        assert!(!ok("https://example.com/", 43120));
        assert!(!ok("http://example.com:43120/", 43120));
        assert!(!ok("http://127.0.0.1.example.com:43120/", 43120));
        assert!(!ok("http://127.0.0.2:43120/", 43120));
        assert!(!ok("http://0.0.0.0:43120/", 43120));
        assert!(!ok("http://[::1]:43120/", 43120));
    }

    #[test]
    fn userinfo_cannot_smuggle_a_host() {
        assert!(!ok("http://127.0.0.1:43120@example.com/", 43120));
        assert!(!ok("http://127.0.0.1:43120:x@example.com/", 43120));
        assert!(!ok("http://user@127.0.0.1:43120/", 43120));
    }

    #[test]
    fn other_ports_on_loopback_are_refused() {
        assert!(!ok("http://127.0.0.1:8080/", 43120));
        assert!(!ok("http://127.0.0.1:43121/", 43120));
        assert!(!ok("http://127.0.0.1/", 43120));
        assert!(ok("http://127.0.0.1/", 80));
    }

    #[test]
    fn localhost_is_refused_even_on_the_service_port() {
        assert!(!ok("http://localhost:43120/", 43120));
        assert!(!ok("http://LOCALHOST:43120/", 43120));
    }

    #[test]
    fn https_on_loopback_is_refused() {
        assert!(!ok("https://127.0.0.1:43120/", 43120));
    }

    #[test]
    fn blob_urls_of_the_service_origin_are_allowed_for_exports() {
        assert!(ok("blob:http://127.0.0.1:43120/4d314ec7-9314-49b9-815e-3552f2429d2c", 43120));
    }

    #[test]
    fn blob_urls_of_other_origins_are_refused() {
        assert!(!ok("blob:http://example.com/abc", 43120));
        assert!(!ok("blob:http://127.0.0.1:8080/abc", 43120));
        assert!(!ok("blob:http://localhost:43120/abc", 43120));
        assert!(!ok("blob:https://127.0.0.1:43120/abc", 43120));
        assert!(!ok("blob:null/abc", 43120));
        assert!(!ok("blob:file:///x", 43120));
        assert!(!ok("blob:blob:http://127.0.0.1:43120/abc", 43120));
        assert!(!ok("blob:", 43120));
    }

    #[test]
    fn local_files_and_other_schemes_are_refused() {
        assert!(!ok("file:///x", 43120));
        assert!(!ok("file:///etc/passwd", 43120));
        assert!(!ok("ftp://127.0.0.1:43120/", 43120));
        assert!(!ok("javascript:alert(1)", 43120));
        assert!(!ok("data:text/html,hi", 43120));
        assert!(!ok("canvas://open/p/id", 43120));
        assert!(!ok("tauri://evil/", 43120));
        assert!(!ok("about:srcdoc", 43120));
    }
}
