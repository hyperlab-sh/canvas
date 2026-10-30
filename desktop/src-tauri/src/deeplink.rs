//! `canvas://open/<project>/<id>` (percent-encoded segments) to the editor's route `/#/p/<project>/<id>`,
//! and `canvas://home` (or the bare `canvas://`) to the editor's home page.

use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};

/// What `encodeURIComponent` leaves alone, so the link matches the one `canvas open` prints.
pub const COMPONENT: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'!').remove(b'~').remove(b'*').remove(b'\'').remove(b'(').remove(b')');

#[derive(Debug, PartialEq, Eq)]
pub struct OpenTarget {
    pub project: String,
    pub id: String,
}

fn segment(raw: &str) -> Option<String> {
    let decoded = percent_decode_str(raw).decode_utf8().ok()?;
    if decoded.is_empty() || decoded.chars().any(char::is_control) {
        return None;
    }
    Some(decoded.into_owned())
}

/// Parses `canvas://open/<project>/<id>`. Anything else (other host, missing or extra segments, bad
/// escapes) is `None`; a query or fragment is ignored.
pub fn parse(link: &str) -> Option<OpenTarget> {
    let rest = link.strip_prefix("canvas://")?;
    let rest = rest.split(['?', '#']).next()?;
    let mut parts = rest.split('/');
    if parts.next()? != "open" {
        return None;
    }
    let project = segment(parts.next()?)?;
    let id = segment(parts.next()?)?;
    // A trailing slash is fine; another segment is not.
    let tail: Vec<&str> = parts.collect();
    (tail.is_empty() || tail == [""]).then_some(OpenTarget { project, id })
}

/// A link the app accepts.
#[derive(Debug, PartialEq, Eq)]
pub enum Link {
    Open(OpenTarget),
    Home,
}

/// Parses any accepted link: `canvas://home` and the bare `canvas://` (a query, fragment or one trailing
/// slash is ignored) are the home page; otherwise as `parse`.
pub fn parse_link(link: &str) -> Option<Link> {
    let rest = link.strip_prefix("canvas://")?;
    let rest = rest.split(['?', '#']).next()?;
    if matches!(rest.strip_suffix('/').unwrap_or(rest), "" | "home") {
        return Some(Link::Home);
    }
    parse(link).map(Link::Open)
}

/// The editor's home screen. The service root `/` is the editor's catch-all, which opens an untitled diagram.
pub fn home_url(origin: &str) -> String {
    format!("{origin}/#/home")
}

/// The editor URL of a link.
pub fn link_url(origin: &str, link: &Link) -> String {
    match link {
        Link::Open(target) => editor_url(origin, target),
        Link::Home => home_url(origin),
    }
}

/// The editor URL for a target, as `lib/open.js` builds it.
pub fn editor_url(origin: &str, target: &OpenTarget) -> String {
    format!(
        "{origin}/#/p/{}/{}",
        utf8_percent_encode(&target.project, COMPONENT),
        utf8_percent_encode(&target.id, COMPONENT)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(project: &str, id: &str) -> Option<OpenTarget> {
        Some(OpenTarget { project: project.into(), id: id.into() })
    }

    #[test]
    fn parses_a_plain_link() {
        assert_eq!(parse("canvas://open/scratch/abc-123"), target("scratch", "abc-123"));
    }

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(parse("canvas://open/my%20proj/a%2Fb"), target("my proj", "a/b"));
        assert_eq!(parse("canvas://open/p/caf%C3%A9"), target("p", "café"));
    }

    #[test]
    fn ignores_trailing_slash_query_and_fragment() {
        assert_eq!(parse("canvas://open/p/i/"), target("p", "i"));
        assert_eq!(parse("canvas://open/p/i?x=1"), target("p", "i"));
        assert_eq!(parse("canvas://open/p/i#frag"), target("p", "i"));
    }

    #[test]
    fn rejects_other_shapes() {
        for bad in [
            "",
            "canvas://open",
            "canvas://open/",
            "canvas://open/p",
            "canvas://open/p/",
            "canvas://open//id",
            "canvas://open/p/i/extra",
            "canvas://open/p/i//",
            "canvas://other/p/i",
            "canvas://opened/p/i",
            "canvas:open/p/i",
            "http://open/p/i",
            "http://example.com/",
            "file:///x",
            "canvas://open/p/%FF",
            "canvas://open/p/a%00b",
            "canvas://open/p/a%0Ab",
        ] {
            assert_eq!(parse(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn parse_still_refuses_the_home_link() {
        assert_eq!(parse("canvas://"), None);
        assert_eq!(parse("canvas://home"), None);
    }

    #[test]
    fn the_home_link_is_canvas_home_or_the_bare_scheme() {
        for good in ["canvas://home", "canvas://", "canvas://home/", "canvas://home?x=1", "canvas://home#f", "canvas:///"] {
            assert_eq!(parse_link(good), Some(Link::Home), "{good:?}");
        }
        assert_eq!(parse_link("canvas://open/p/i"), Some(Link::Open(OpenTarget { project: "p".into(), id: "i".into() })));
        for bad in ["", "canvas:home", "canvas://homes", "canvas://home/x", "canvas://other", "canvas://open", "http://home", "canvas://open/p"] {
            assert_eq!(parse_link(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn the_home_link_shows_the_service_origin() {
        assert_eq!(link_url("http://127.0.0.1:43120", &Link::Home), "http://127.0.0.1:43120/#/home");
        assert_eq!(link_url("http://127.0.0.1:43120", &parse_link("canvas://open/a/b").unwrap()), "http://127.0.0.1:43120/#/p/a/b");
    }

    #[test]
    fn builds_the_editor_url() {
        let origin = "http://127.0.0.1:43120";
        assert_eq!(editor_url(origin, &OpenTarget { project: "scratch".into(), id: "abc".into() }), "http://127.0.0.1:43120/#/p/scratch/abc");
    }

    #[test]
    fn encodes_like_encode_uri_component() {
        let url = editor_url("http://127.0.0.1:1", &OpenTarget { project: "my proj".into(), id: "a/b?c#d&e'f(g)~h".into() });
        assert_eq!(url, "http://127.0.0.1:1/#/p/my%20proj/a%2Fb%3Fc%23d%26e'f(g)~h");
    }

    #[test]
    fn a_link_cannot_leave_the_origin() {
        let url = editor_url("http://127.0.0.1:43120", &parse("canvas://open/%2F%2Fevil.com/..%2F..").unwrap());
        let route = url.strip_prefix("http://127.0.0.1:43120/#/p/").expect(&url);
        assert_eq!(route.split('/').count(), 2, "{url}");
    }

    #[test]
    fn round_trips_through_parse() {
        let original = OpenTarget { project: "p q".into(), id: "ü/x".into() };
        let link = format!("canvas://open/{}/{}", utf8_percent_encode(&original.project, COMPONENT), utf8_percent_encode(&original.id, COMPONENT));
        assert_eq!(parse(&link), Some(original));
    }
}
