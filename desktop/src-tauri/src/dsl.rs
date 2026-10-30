//! The editor's `#/from/dsl?d=<payload>&t=<title>` link: the payload is base64url (no padding) of
//! deflate-raw(utf8 text), as `dslLink.ts` builds it.

use std::io::Write;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use flate2::write::DeflateEncoder;
use flate2::Compression;
use percent_encoding::utf8_percent_encode;

use crate::deeplink::COMPONENT;

/// The most text the route decodes (`MAX_DSL_BYTES`); a bigger file is refused here, not by a broken page.
pub const MAX_BYTES: usize = 1024 * 1024;

pub fn payload(text: &str) -> String {
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(text.as_bytes()).expect("writing to memory");
    URL_SAFE_NO_PAD.encode(encoder.finish().expect("writing to memory"))
}

/// The editor URL that opens `text` as a new diagram titled `title` (the title is omitted when empty).
pub fn editor_url(origin: &str, text: &str, title: &str) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("the file is empty".into());
    }
    if text.len() > MAX_BYTES {
        return Err(format!("the file is larger than {} MB", MAX_BYTES / 1024 / 1024));
    }
    let title = title.trim();
    let name = if title.is_empty() { String::new() } else { format!("&t={}", utf8_percent_encode(title, COMPONENT)) };
    Ok(format!("{origin}/#/from/dsl?d={}{name}", payload(text)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::read::DeflateDecoder;
    use std::io::Read;

    fn decode(payload: &str) -> String {
        let bytes = URL_SAFE_NO_PAD.decode(payload).expect("base64url");
        let mut text = String::new();
        DeflateDecoder::new(&bytes[..]).read_to_string(&mut text).expect("deflate-raw");
        text
    }

    fn payload_of(url: &str) -> &str {
        url.split("?d=").nth(1).unwrap().split('&').next().unwrap()
    }

    #[test]
    fn payload_round_trips() {
        for text in ["flowchart TD\n  A --> B\n", "café → ünïcode ✓", &"x".repeat(100_000)] {
            assert_eq!(decode(&payload(text)), text);
        }
    }

    #[test]
    fn payload_uses_only_the_url_safe_alphabet() {
        let encoded = payload(&"?>~ÿ".repeat(500));
        assert!(encoded.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'), "{encoded}");
    }

    #[test]
    fn builds_the_route_with_the_title() {
        let url = editor_url("http://127.0.0.1:43120", "graph LR\n A-->B", "My flow & more").unwrap();
        assert!(url.starts_with("http://127.0.0.1:43120/#/from/dsl?d="), "{url}");
        assert!(url.ends_with("&t=My%20flow%20%26%20more"), "{url}");
        assert_eq!(decode(payload_of(&url)), "graph LR\n A-->B");
    }

    #[test]
    fn omits_an_empty_title() {
        let url = editor_url("http://127.0.0.1:1", "a", "  ").unwrap();
        assert!(!url.contains("&t="), "{url}");
    }

    #[test]
    fn refuses_empty_and_oversized_text() {
        assert!(editor_url("http://127.0.0.1:1", " \n", "t").is_err());
        assert!(editor_url("http://127.0.0.1:1", &"a".repeat(MAX_BYTES + 1), "t").is_err());
        assert!(editor_url("http://127.0.0.1:1", &"a".repeat(MAX_BYTES), "t").is_ok());
    }
}
