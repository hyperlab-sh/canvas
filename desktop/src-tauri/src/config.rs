//! Which port the service listens on: `CANVAS_PORT`, else the service config file's `port`, else 43120.

use std::path::PathBuf;

pub const DEFAULT_PORT: u16 = 43120;

fn parse_port(text: &str) -> Option<u16> {
    text.trim().parse::<u16>().ok().filter(|port| *port != 0)
}

/// `env_port` is the value of `CANVAS_PORT`, `config_text` the service config file's contents.
/// An unusable value falls through to the next source, as the service itself would not start on it.
pub fn resolve_port(env_port: Option<&str>, config_text: Option<&str>) -> u16 {
    if let Some(port) = env_port.and_then(parse_port) {
        return port;
    }
    config_text
        .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
        .and_then(|config| config.get("port").and_then(|port| port.as_u64()))
        .and_then(|port| u16::try_from(port).ok())
        .filter(|port| *port != 0)
        .unwrap_or(DEFAULT_PORT)
}

/// The service's config path: `CANVAS_SERVICE_CONFIG`, else `~/.config/canvas/service.json`.
fn config_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CANVAS_SERVICE_CONFIG").filter(|path| !path.is_empty()) {
        return Some(PathBuf::from(path));
    }
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(PathBuf::from(home).join(".config").join("canvas").join("service.json"))
}

pub fn port() -> u16 {
    let env_port = std::env::var("CANVAS_PORT").ok();
    let text = config_path().and_then(|path| std::fs::read_to_string(path).ok());
    resolve_port(env_port.as_deref(), text.as_deref())
}

pub fn service_origin(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_without_any_source() {
        assert_eq!(resolve_port(None, None), 43120);
    }

    #[test]
    fn env_beats_the_config_file() {
        assert_eq!(resolve_port(Some("5000"), Some(r#"{"port": 6000}"#)), 5000);
    }

    #[test]
    fn config_file_beats_the_default() {
        assert_eq!(resolve_port(None, Some(r#"{"port": 6000, "projects": []}"#)), 6000);
    }

    #[test]
    fn env_is_trimmed() {
        assert_eq!(resolve_port(Some(" 5000\n"), None), 5000);
    }

    #[test]
    fn unusable_env_falls_through_to_the_config_file() {
        for bad in ["", "abc", "0", "65536", "-1", "80.5"] {
            assert_eq!(resolve_port(Some(bad), Some(r#"{"port": 6000}"#)), 6000, "{bad:?}");
        }
    }

    #[test]
    fn unusable_config_falls_through_to_the_default() {
        for bad in ["", "not json", "{}", r#"{"port": "6000"}"#, r#"{"port": 0}"#, r#"{"port": 70000}"#, r#"{"port": -5}"#, r#"{"port": 1.5}"#, "[]"] {
            assert_eq!(resolve_port(None, Some(bad)), 43120, "{bad:?}");
        }
    }

    #[test]
    fn origin_is_loopback_ip() {
        assert_eq!(service_origin(43120), "http://127.0.0.1:43120");
    }
}
