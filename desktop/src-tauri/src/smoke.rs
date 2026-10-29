//! `--smoke`: load the service, wait for the editor to mount, print one JSON line, exit 0 or 1.

use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const MOUNT_TIMEOUT: Duration = Duration::from_secs(30);
/// Injected into the editor page in smoke mode.
pub const SCRIPT: &str = include_str!("smoke.js");

/// What the injected script reports: the editor's state and the errors seen so far.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    pub mounted: bool,
    pub errors: Vec<String>,
    pub url: String,
}

pub struct SmokeSender(pub Mutex<Sender<Report>>);

/// The result line: `ok` is whether the editor mounted; `errors` are informational (console errors,
/// uncaught exceptions and rejections up to that point).
pub fn result_line(mounted: bool, errors: &[String], url: &str) -> String {
    serde_json::json!({ "ok": mounted, "mounted": mounted, "errors": errors, "url": url }).to_string()
}

/// Waits for a mounted report until `timeout`; the outcome is the line to print and the exit code.
pub fn wait(reports: &Receiver<Report>, timeout: Duration, url: &str) -> (String, i32) {
    let deadline = Instant::now() + timeout;
    let mut errors: Vec<String> = Vec::new();
    loop {
        match reports.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(report) if report.mounted => return (result_line(true, &report.errors, &report.url), 0),
            Ok(report) => errors = report.errors,
            Err(RecvTimeoutError::Timeout) => {
                errors.push(format!("the editor did not mount within {} s", timeout.as_secs()));
                return (result_line(false, &errors, url), 1);
            }
            Err(RecvTimeoutError::Disconnected) => {
                errors.push("the window closed before the editor mounted".into());
                return (result_line(false, &errors, url), 1);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    fn report(mounted: bool, errors: &[&str]) -> Report {
        Report { mounted, errors: errors.iter().map(|e| e.to_string()).collect(), url: "http://127.0.0.1:1/#/x".into() }
    }

    #[test]
    fn the_line_is_one_json_object() {
        let line = result_line(true, &["a \"quoted\"\nerror".into()], "http://127.0.0.1:1/");
        assert!(!line.contains('\n'));
        let json: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(json["ok"], true);
        assert_eq!(json["mounted"], true);
        assert_eq!(json["errors"][0], "a \"quoted\"\nerror");
        assert_eq!(json["url"], "http://127.0.0.1:1/");
    }

    #[test]
    fn a_mounted_report_exits_zero_with_its_errors() {
        let (sender, receiver) = channel();
        sender.send(report(false, &["early"])).unwrap();
        sender.send(report(true, &["early", "late"])).unwrap();
        let (line, code) = wait(&receiver, Duration::from_secs(5), "u");
        let json: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(code, 0);
        assert_eq!((json["ok"].as_bool(), json["errors"].as_array().map(Vec::len)), (Some(true), Some(2)));
        assert_eq!(json["url"], "http://127.0.0.1:1/#/x");
    }

    #[test]
    fn no_mount_before_the_deadline_exits_one_and_keeps_the_errors() {
        let (sender, receiver) = channel();
        sender.send(report(false, &["boom"])).unwrap();
        let (line, code) = wait(&receiver, Duration::ZERO, "http://127.0.0.1:1/#/");
        let json: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(code, 1);
        assert_eq!(json["ok"], false);
        assert_eq!(json["mounted"], false);
        assert_eq!(json["errors"][0], "boom");
        assert!(json["errors"][1].as_str().unwrap().contains("did not mount"));
        assert_eq!(json["url"], "http://127.0.0.1:1/#/");
        drop(sender);
    }

    #[test]
    fn a_closed_window_exits_one() {
        let (sender, receiver) = channel::<Report>();
        drop(sender);
        let (line, code) = wait(&receiver, Duration::from_secs(5), "u");
        assert_eq!(code, 1);
        assert!(line.contains("window closed"));
    }
}
