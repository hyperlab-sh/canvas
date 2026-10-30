//! The routing decisions behind the window: where it starts, what a deep link does, what "open the
//! service" navigates to. Pure, so the branches AC-2 depends on are unit-tested; `main.rs` only applies them.

use crate::deeplink::{editor_url, home_url, OpenTarget};

#[derive(Debug, PartialEq, Eq)]
pub enum Start {
    /// The bundled "service not running" page.
    Bundled,
    /// A page on the service origin.
    External(String),
}

/// The first page, and the deep-link URL to hold until the service answers (only when it does not now).
pub fn start_target(smoke: bool, service_up: bool, cold_link: Option<&OpenTarget>, origin: &str) -> (Start, Option<String>) {
    if smoke {
        return (Start::External(format!("{origin}/#/")), None);
    }
    let link = cold_link.map(|target| editor_url(origin, target));
    if service_up {
        (Start::External(link.unwrap_or_else(|| home_url(origin))), None)
    } else {
        (Start::Bundled, link)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum LinkAction {
    /// The service answers: show the diagram.
    Navigate(String),
    /// It does not and the bundled page is already showing: hold the URL, the page hands over.
    HoldOnly(String),
    /// It does not and the window shows something else (a dead editor): hold the URL and show the bundled page.
    HoldAndShowBundled(String),
}

pub fn after_link(service_up: bool, on_bundled: bool, url: String) -> LinkAction {
    match (service_up, on_bundled) {
        (true, _) => LinkAction::Navigate(url),
        (false, true) => LinkAction::HoldOnly(url),
        (false, false) => LinkAction::HoldAndShowBundled(url),
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum FileAction {
    /// The service answers: resolve the file and show it.
    Open,
    /// It does not and the bundled page is already showing: hold the file, the page hands over.
    HoldOnly,
    /// It does not and the window shows something else: hold the file and show the bundled page.
    HoldAndShowBundled,
}

pub fn after_file(service_up: bool, on_bundled: bool) -> FileAction {
    match (service_up, on_bundled) {
        (true, _) => FileAction::Open,
        (false, true) => FileAction::HoldOnly,
        (false, false) => FileAction::HoldAndShowBundled,
    }
}

/// Whether the bundled page's hand-over may navigate: only while the bundled page is still showing, so a
/// link that already moved the window to a diagram is not overwritten by the page's in-flight probe.
pub fn may_hand_over(on_bundled: bool) -> bool {
    on_bundled
}

/// What `open_service` navigates to: the held link, else the editor home. The link stays held until that works.
pub fn open_url(pending: Option<&str>, origin: &str) -> String {
    pending.map_or_else(|| home_url(origin), str::to_string)
}

#[derive(Debug, PartialEq, Eq)]
pub enum Resolved {
    /// The window already moved to something else: a link or drop that moved it wins.
    Abandon,
    /// A request was held while the file resolved (the service stopped answering): serve that instead.
    Retry,
    /// Nothing newer: show what resolved.
    Navigate,
}

/// What the hand-over does once a held file has resolved (the resolve awaited, so the world may have moved).
pub fn after_resolve(on_bundled: bool, link_held: bool, file_held: bool) -> Resolved {
    if !may_hand_over(on_bundled) {
        Resolved::Abandon
    } else if link_held || file_held {
        Resolved::Retry
    } else {
        Resolved::Navigate
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGIN: &str = "http://127.0.0.1:43120";

    fn link() -> OpenTarget {
        OpenTarget { project: "scratch".into(), id: "abc".into() }
    }

    #[test]
    fn smoke_always_loads_the_editor_and_holds_nothing() {
        for up in [true, false] {
            for cold in [None, Some(link())] {
                assert_eq!(start_target(true, up, cold.as_ref(), ORIGIN), (Start::External(format!("{ORIGIN}/#/")), None));
            }
        }
    }

    #[test]
    fn service_up_without_a_link_opens_the_editor_home() {
        assert_eq!(start_target(false, true, None, ORIGIN), (Start::External(format!("{ORIGIN}/#/home")), None));
    }

    #[test]
    fn service_up_with_a_link_opens_that_diagram() {
        assert_eq!(start_target(false, true, Some(&link()), ORIGIN), (Start::External(format!("{ORIGIN}/#/p/scratch/abc")), None));
    }

    #[test]
    fn service_down_shows_the_bundled_page_and_holds_the_link() {
        assert_eq!(start_target(false, false, Some(&link()), ORIGIN), (Start::Bundled, Some(format!("{ORIGIN}/#/p/scratch/abc"))));
        assert_eq!(start_target(false, false, None, ORIGIN), (Start::Bundled, None));
    }

    #[test]
    fn a_link_navigates_when_up_and_is_held_with_the_bundled_page_when_down() {
        for on_bundled in [true, false] {
            assert_eq!(after_link(true, on_bundled, "u".into()), LinkAction::Navigate("u".into()));
        }
        assert_eq!(after_link(false, false, "u".into()), LinkAction::HoldAndShowBundled("u".into()));
    }

    #[test]
    fn a_link_while_down_does_not_reload_the_bundled_page() {
        assert_eq!(after_link(false, true, "u".into()), LinkAction::HoldOnly("u".into()));
    }

    #[test]
    fn a_file_opens_when_up_and_is_held_when_down() {
        for on_bundled in [true, false] {
            assert_eq!(after_file(true, on_bundled), FileAction::Open);
        }
        assert_eq!(after_file(false, true), FileAction::HoldOnly);
        assert_eq!(after_file(false, false), FileAction::HoldAndShowBundled);
    }

    #[test]
    fn hand_over_only_from_the_bundled_page() {
        assert!(may_hand_over(true));
        assert!(!may_hand_over(false));
    }

    #[test]
    fn open_prefers_the_held_link_and_falls_back_to_the_editor_home() {
        assert_eq!(open_url(Some("http://127.0.0.1:43120/#/p/a/b"), ORIGIN), "http://127.0.0.1:43120/#/p/a/b");
        assert_eq!(open_url(None, ORIGIN), format!("{ORIGIN}/#/home"));
    }

    #[test]
    fn after_resolve_abandons_retries_or_navigates() {
        assert_eq!(after_resolve(false, true, true), Resolved::Abandon);
        assert_eq!(after_resolve(true, true, false), Resolved::Retry);
        assert_eq!(after_resolve(true, false, true), Resolved::Retry);
        assert_eq!(after_resolve(true, false, false), Resolved::Navigate);
    }

    #[test]
    fn the_home_link_routes_like_any_other_link() {
        let url = crate::deeplink::link_url(ORIGIN, &crate::deeplink::Link::Home);
        assert_eq!(after_link(true, false, url.clone()), LinkAction::Navigate(format!("{ORIGIN}/#/home")));
        assert_eq!(after_link(false, true, url.clone()), LinkAction::HoldOnly(format!("{ORIGIN}/#/home")));
        assert_eq!(after_link(false, false, url), LinkAction::HoldAndShowBundled(format!("{ORIGIN}/#/home")));
    }
}
