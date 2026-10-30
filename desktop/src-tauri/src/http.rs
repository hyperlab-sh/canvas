//! A minimal HTTP/1.1 client for the loopback service: one request per connection, JSON in and out.
//! The service is the only peer, so no HTTP library is pulled in (like `service::probe`).

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use serde_json::Value;

const TIMEOUT: Duration = Duration::from_secs(10);
/// Largest reply read; a project listing is the biggest one the app asks for.
const MAX_REPLY: u64 = 16 * 1024 * 1024;

pub fn build_request(port: u16, method: &str, path: &str, body: Option<&str>) -> Vec<u8> {
    let mut head = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: close\r\n");
    if let Some(body) = body {
        // The service accepts writes only as application/json.
        head.push_str(&format!("Content-Type: application/json\r\nContent-Length: {}\r\n", body.len()));
    }
    head.push_str("\r\n");
    let mut request = head.into_bytes();
    request.extend_from_slice(body.unwrap_or("").as_bytes());
    request
}

fn dechunk(mut rest: &[u8]) -> Result<Vec<u8>, String> {
    let mut body = Vec::new();
    loop {
        let line_end = rest.windows(2).position(|pair| pair == b"\r\n").ok_or("truncated chunked reply")?;
        let size_text = std::str::from_utf8(&rest[..line_end]).map_err(|_| "bad chunk size")?;
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or("").trim(), 16).map_err(|_| "bad chunk size")?;
        rest = &rest[line_end + 2..];
        if size == 0 {
            return Ok(body);
        }
        if rest.len() < size {
            return Err("truncated chunked reply".into());
        }
        body.extend_from_slice(&rest[..size]);
        rest = rest.get(size + 2..).ok_or("truncated chunked reply")?;
    }
}

/// The status and body of a raw reply (read to the connection's end).
pub fn parse_response(raw: &[u8]) -> Result<(u16, Vec<u8>), String> {
    let split = raw.windows(4).position(|window| window == b"\r\n\r\n").ok_or("the service sent no complete reply")?;
    let head = String::from_utf8_lossy(&raw[..split]);
    let mut lines = head.lines();
    let status = lines
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or("the service sent no status")?;
    let chunked = lines.any(|line| {
        let line = line.to_ascii_lowercase();
        line.starts_with("transfer-encoding:") && line.contains("chunked")
    });
    let body = &raw[split + 4..];
    Ok((status, if chunked { dechunk(body)? } else { body.to_vec() }))
}

/// Sends one request to the service on `port`; the JSON body of the reply (null when empty) and its status.
pub fn send(port: u16, method: &str, path: &str, body: Option<&Value>) -> Result<(u16, Value), String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, TIMEOUT).map_err(|error| format!("cannot reach the service: {error}"))?;
    let _ = stream.set_read_timeout(Some(TIMEOUT));
    let _ = stream.set_write_timeout(Some(TIMEOUT));
    let payload = body.map(Value::to_string);
    stream.write_all(&build_request(port, method, path, payload.as_deref())).map_err(|error| error.to_string())?;
    let mut raw = Vec::new();
    stream.take(MAX_REPLY).read_to_end(&mut raw).map_err(|error| error.to_string())?;
    let (status, bytes) = parse_response(&raw)?;
    let json = if bytes.iter().all(u8::is_ascii_whitespace) {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).map_err(|_| format!("the service answered {status} with something that is not JSON"))?
    };
    Ok((status, json))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_get_has_no_body_headers() {
        let request = String::from_utf8(build_request(43120, "GET", "/projects", None)).unwrap();
        assert!(request.starts_with("GET /projects HTTP/1.1\r\nHost: 127.0.0.1:43120\r\n"), "{request}");
        assert!(request.ends_with("\r\n\r\n"));
        assert!(!request.contains("Content-"), "{request}");
    }

    #[test]
    fn a_write_declares_json_and_the_exact_length() {
        let request = String::from_utf8(build_request(1, "POST", "/p", Some(r#"{"name":"é"}"#))).unwrap();
        assert!(request.contains("Content-Type: application/json\r\n"), "{request}");
        // é is two bytes: the length counts bytes, not characters.
        assert!(request.contains("Content-Length: 13\r\n"), "{request}");
        assert!(request.ends_with("\r\n\r\n{\"name\":\"é\"}"), "{request}");
    }

    #[test]
    fn parses_a_plain_reply() {
        let raw = b"HTTP/1.1 201 Created\r\nContent-Type: application/json\r\n\r\n{\"id\":\"a\"}";
        assert_eq!(parse_response(raw).unwrap(), (201, b"{\"id\":\"a\"}".to_vec()));
    }

    #[test]
    fn parses_a_chunked_reply() {
        let raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\n{\"a\":\r\n3\r\n1}\n\r\n0\r\n\r\n";
        assert_eq!(parse_response(raw).unwrap(), (200, b"{\"a\":1}\n".to_vec()));
    }

    #[test]
    fn rejects_replies_that_are_cut_short() {
        assert!(parse_response(b"").is_err());
        assert!(parse_response(b"HTTP/1.1 200 OK\r\n").is_err());
        assert!(parse_response(b"garbage\r\n\r\n").is_err());
        assert!(parse_response(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n9\r\nshort").is_err());
        assert!(parse_response(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\n").is_err());
    }
}
