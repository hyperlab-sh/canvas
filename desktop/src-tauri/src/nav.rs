//! The navigation guard: the window may only show the bundled page or the service on loopback.
//!
//! `localhost` is refused on purpose: it may resolve to `::1` or to another host entry, and the IPC
//! capability and the service's Host check are written for `127.0.0.1` only. Everything else (other ports,
//! https, file:, other hosts, userinfo tricks) is refused too. `blob:` URLs are allowed only when they were
//! minted by the service origin: the editor's exports are `<a download href="blob:...">` navigations.
//!
//! What the window may not show is not always dropped: a link to another site (`http`, `https`, `mailto`) is
//! handed to the system's default handler, so clicking it neither navigates the window nor does nothing.

use tauri::Url;

/// The bundled page's URL: `tauri://localhost/` (macOS, Linux) or `http://tauri.localhost/` (Windows).
pub fn bundled_url() -> Url {
    Url::parse(if cfg!(windows) { "http://tauri.localhost/" } else { "tauri://localhost/" }).expect("static URL")
}

/// Whether `url` is the bundled page (any platform's form).
pub fn is_bundled(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => url.host_str() == Some("tauri.localhost"),
        _ => false,
    }
}

/// Whether the window may navigate to `url` when the service listens on `port`.
pub fn allowed(url: &Url, port: u16) -> bool {
    match url.scheme() {
        _ if is_bundled(url) => true,
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

/// What a link click, `target="_blank"` or `window.open` leads to.
#[derive(Debug, PartialEq, Eq)]
pub enum Link {
    /// The window shows it (the bundled page, the service origin, its blob URLs).
    Window,
    /// The system default browser or mail handler opens it; the window stays where it is.
    System,
    /// Nobody opens it: `file:`, `javascript:`, `canvas:` and every other scheme.
    Refused,
}

/// Where `url` goes when the service listens on `port`.
pub fn route(url: &Url, port: u16) -> Link {
    if allowed(url, port) {
        Link::Window
    } else if matches!(url.scheme(), "http" | "https" | "mailto") {
        Link::System
    } else {
        Link::Refused
    }
}

/// Applies `route` to a link the window may not show: opens the system-handled ones, logs the refused.
/// Returns whether the window may show it.
pub fn dispatch(url: &Url, port: u16, open: impl FnOnce(&str)) -> bool {
    match route(url, port) {
        Link::Window => true,
        Link::System => {
            open(url.as_str());
            false
        }
        Link::Refused => {
            eprintln!("canvas-app: refused to navigate to {url}");
            false
        }
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
    fn is_bundled_matches_only_the_bundled_forms() {
        for yes in ["tauri://localhost/", "http://tauri.localhost/x", "https://tauri.localhost/"] {
            assert!(is_bundled(&Url::parse(yes).unwrap()), "{yes}");
        }
        for no in ["http://127.0.0.1:43120/", "tauri://evil/", "http://localhost/", "file:///x"] {
            assert!(!is_bundled(&Url::parse(no).unwrap()), "{no}");
        }
        assert!(allowed(&bundled_url(), 43120));
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

    fn link(url: &str, port: u16) -> Link {
        route(&Url::parse(url).expect(url), port)
    }

    #[test]
    fn links_within_the_service_origin_stay_in_the_window() {
        assert_eq!(link("http://127.0.0.1:43120/#/p/a/b", 43120), Link::Window);
        assert_eq!(link("blob:http://127.0.0.1:43120/abc", 43120), Link::Window);
        assert_eq!(link("tauri://localhost/", 43120), Link::Window);
        assert_eq!(link("http://tauri.localhost/", 43120), Link::Window);
    }

    #[test]
    fn links_to_other_sites_go_to_the_system() {
        for url in [
            "https://console.anthropic.com/settings/keys",
            "http://example.com/",
            "https://tauri.localhost.evil.com/",
            "http://127.0.0.1:8080/",
            "http://localhost:43120/",
            "https://127.0.0.1:43120/",
            "http://127.0.0.1:43120@example.com/",
            "mailto:me@example.com",
            "mailto:me@example.com?subject=hi",
        ] {
            assert_eq!(link(url, 43120), Link::System, "{url}");
        }
    }

    #[test]
    fn other_schemes_are_never_handed_to_the_system() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hi",
            "canvas://open/p/id",
            "ftp://example.com/",
            "tel:+1555",
            "vscode://file/x",
            "blob:http://example.com/abc",
            "blob:null/abc",
            "about:srcdoc",
            "tauri://evil/",
        ] {
            assert_eq!(link(url, 43120), Link::Refused, "{url}");
        }
    }

    #[test]
    fn dispatch_opens_only_the_system_links() {
        let run = |url: &str| {
            let mut opened = Vec::new();
            let shown = dispatch(&Url::parse(url).unwrap(), 43120, |u| opened.push(u.to_string()));
            (shown, opened)
        };
        assert_eq!(run("http://127.0.0.1:43120/x"), (true, vec![]));
        assert_eq!(run("https://example.com/a?b=1"), (false, vec!["https://example.com/a?b=1".to_string()]));
        assert_eq!(run("mailto:a@b.c"), (false, vec!["mailto:a@b.c".to_string()]));
        assert_eq!(run("file:///etc/passwd"), (false, vec![]));
        assert_eq!(run("canvas://open/p/id"), (false, vec![]));
    }
}
