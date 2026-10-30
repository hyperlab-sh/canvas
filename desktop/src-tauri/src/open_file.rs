//! Opening a file as a diagram (D5): a `.openflow.json` in a configured project opens in place; one outside
//! every project is imported into `scratch` through the service API; `.mmd` and `.openflow` text opens
//! through the editor's `#/from/dsl` route. The result is always an editor URL on the service origin.

use std::path::{Path, PathBuf};

use percent_encoding::utf8_percent_encode;
use serde_json::{json, Value};

use crate::deeplink::{editor_url, OpenTarget, COMPONENT};
use crate::files::{self, Kind};
use crate::{dsl, http};

pub const SCRATCH: &str = "scratch";

/// What the importer needs from the service. The real one is `Service`; the tests use a recording fake.
pub trait Backend {
    /// `GET /projects`.
    fn projects(&self) -> Result<Value, String>;
    /// `POST /projects/<project>/diagrams`: the new diagram's id and revision.
    fn create(&self, project: &str, name: &str) -> Result<(String, i64), String>;
    /// `PUT /projects/<project>/diagrams/<id>`.
    fn save(&self, project: &str, id: &str, document: &Value, revision: i64) -> Result<(), String>;
}

pub struct Service(pub u16);

fn segment(text: &str) -> String {
    utf8_percent_encode(text, COMPONENT).to_string()
}

pub fn create_path(project: &str) -> String {
    format!("/projects/{}/diagrams", segment(project))
}

pub fn save_path(project: &str, id: &str) -> String {
    format!("{}/{}", create_path(project), segment(id))
}

/// The reply's own error text when it has one, else the status.
fn failure(status: u16, body: &Value) -> String {
    match body.get("error").or_else(|| body.get("message")).and_then(Value::as_str) {
        Some(text) => format!("the service answered {status}: {text}"),
        None => format!("the service answered {status}"),
    }
}

/// `POST /projects/<project>/diagrams`: path and body.
pub fn create_request(project: &str, name: &str) -> (String, Value) {
    (create_path(project), json!({ "name": name }))
}

/// `PUT /projects/<project>/diagrams/<id>`: path and body.
pub fn save_request(project: &str, id: &str, document: &Value, revision: i64) -> (String, Value) {
    (save_path(project, id), json!({ "document": document, "revision": revision }))
}

/// The id and revision of the diagram a `POST` created.
pub fn created(status: u16, body: &Value) -> Result<(String, i64), String> {
    if status != 201 {
        return Err(failure(status, body));
    }
    let id = body.get("id").and_then(Value::as_str).ok_or("the service created a diagram without an id")?;
    let revision = body.get("revision").and_then(Value::as_i64).ok_or("the service created a diagram without a revision")?;
    Ok((id.to_string(), revision))
}

/// Whether a `PUT` saved.
pub fn saved(status: u16, body: &Value) -> Result<(), String> {
    if status == 200 { Ok(()) } else { Err(failure(status, body)) }
}

impl Backend for Service {
    fn projects(&self) -> Result<Value, String> {
        match http::send(self.0, "GET", "/projects", None)? {
            (200, body) => Ok(body),
            (status, body) => Err(failure(status, &body)),
        }
    }

    fn create(&self, project: &str, name: &str) -> Result<(String, i64), String> {
        let (path, body) = create_request(project, name);
        let (status, reply) = http::send(self.0, "POST", &path, Some(&body))?;
        created(status, &reply)
    }

    fn save(&self, project: &str, id: &str, document: &Value, revision: i64) -> Result<(), String> {
        let (path, body) = save_request(project, id, document, revision);
        let (status, reply) = http::send(self.0, "PUT", &path, Some(&body))?;
        saved(status, &reply)
    }
}

/// The configured project whose folder is `folder`, compared by real path (symlinks, `..`, case on macOS).
/// A project whose folder cannot be resolved never matches.
pub fn owner(projects: &Value, folder: &Path, real: impl Fn(&Path) -> Option<PathBuf>) -> Option<String> {
    let folder = real(folder)?;
    projects.as_array()?.iter().find_map(|project| {
        let name = project.get("name")?.as_str()?;
        let path = project.get("path")?.as_str()?;
        (real(Path::new(path))? == folder).then(|| name.to_string())
    })
}

/// Whether the service lists a diagram `id` in `project`. The service scans only names ending in the exact,
/// lower-case `.openflow.json`, so a file it skips (another suffix case) is not listed.
pub fn lists(projects: &Value, project: &str, id: &str) -> bool {
    projects
        .as_array()
        .and_then(|all| all.iter().find(|candidate| candidate.get("name").and_then(Value::as_str) == Some(project)))
        .and_then(|found| found.get("diagrams"))
        .and_then(Value::as_array)
        .is_some_and(|entries| entries.iter().any(|entry| entry.get("id").and_then(Value::as_str) == Some(id)))
}

/// How many files in `folder` the service would read as the diagram `id`. The listing sends no file names, and
/// the service answers 409 for an id two files share, so a count above one cannot be opened in place.
pub fn holders(folder: &Path, id: &str) -> usize {
    let Ok(entries) = std::fs::read_dir(folder) else { return 0 };
    entries
        .flatten()
        .filter(|entry| entry.file_name().to_str().is_some_and(|name| name.ends_with(".openflow.json")))
        .filter_map(|entry| std::fs::read(entry.path()).ok())
        .filter_map(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .filter(|document| document.get("id").and_then(Value::as_str) == Some(id))
        .count()
}

fn real_path(path: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(path).ok()
}

/// The document with its id replaced: an imported copy must not share the id of the file it came from.
pub fn with_id(document: &Value, id: &str) -> Value {
    let mut copy = document.clone();
    copy["id"] = Value::String(id.to_string());
    copy
}

fn open_diagram(origin: &str, path: &Path, backend: &dyn Backend) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    let document: Value = serde_json::from_slice(&bytes).map_err(|_| format!("{} is not a diagram file (not JSON)", path.display()))?;
    let id = document
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| format!("{} is not a diagram file (no \"id\")", path.display()))?;

    let folder = path.parent().filter(|parent| !parent.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let projects = backend.projects()?;
    if let Some(project) = owner(&projects, folder, real_path) {
        if lists(&projects, &project, id) && holders(folder, id) <= 1 {
            return Ok(editor_url(origin, &OpenTarget { project, id: id.to_string() }));
        }
    }

    let name = document.get("name").and_then(Value::as_str).map(str::trim).filter(|name| !name.is_empty()).map_or_else(|| files::title(path), str::to_string);
    let (new_id, revision) = backend.create(SCRATCH, &name)?;
    // There is no DELETE route: a rejected document leaves the empty diagram behind, so say which one.
    backend.save(SCRATCH, &new_id, &with_id(&document, &new_id), revision).map_err(|error| format!("created {SCRATCH}/{new_id} but could not save it: {error}"))?;
    Ok(editor_url(origin, &OpenTarget { project: SCRATCH.to_string(), id: new_id }))
}

fn open_text(origin: &str, path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    // Refuse before decoding what is plainly too big to be a diagram.
    if bytes.len() > dsl::MAX_BYTES {
        return Err(format!("{} is larger than {} MB", path.display(), dsl::MAX_BYTES / 1024 / 1024));
    }
    let text = String::from_utf8(bytes).map_err(|_| format!("{} is not UTF-8 text", path.display()))?;
    dsl::editor_url(origin, text.strip_prefix('\u{feff}').unwrap_or(&text), &files::title(path)).map_err(|error| format!("{}: {error}", path.display()))
}

/// The editor URL that shows `path`. Fails with a readable reason; nothing is navigated on failure.
pub fn resolve(origin: &str, path: &Path, backend: &dyn Backend) -> Result<String, String> {
    match files::kind(path) {
        Some(Kind::Diagram) => open_diagram(origin, path, backend),
        Some(Kind::Dsl) => open_text(origin, path),
        None => Err(format!("{} is not a diagram file", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::fs;

    const ORIGIN: &str = "http://127.0.0.1:43120";

    #[derive(Default)]
    struct Fake {
        projects: Value,
        calls: RefCell<Vec<String>>,
        saved: RefCell<Vec<(String, String, Value, i64)>>,
        fail_save: bool,
    }

    impl Backend for Fake {
        fn projects(&self) -> Result<Value, String> {
            self.calls.borrow_mut().push("projects".into());
            Ok(self.projects.clone())
        }
        fn create(&self, project: &str, name: &str) -> Result<(String, i64), String> {
            self.calls.borrow_mut().push(format!("create {project} {name}"));
            Ok(("new-id".into(), 7))
        }
        fn save(&self, project: &str, id: &str, document: &Value, revision: i64) -> Result<(), String> {
            self.calls.borrow_mut().push(format!("save {project} {id}"));
            if self.fail_save {
                return Err("boom".into());
            }
            self.saved.borrow_mut().push((project.into(), id.into(), document.clone(), revision));
            Ok(())
        }
    }

    fn write(dir: &Path, name: &str, text: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, text).unwrap();
        path
    }

    fn fake_with(projects: Value) -> Fake {
        Fake { projects, ..Default::default() }
    }

    #[test]
    fn a_file_in_a_project_opens_in_place_without_importing() {
        let dir = tempfile::tempdir().unwrap();
        let file = write(dir.path(), "flow.openflow.json", r#"{"id":"abc","name":"Flow"}"#);
        let backend = fake_with(listed(dir.path(), "abc"));
        assert_eq!(resolve(ORIGIN, &file, &backend).unwrap(), "http://127.0.0.1:43120/#/p/work/abc");
        assert_eq!(*backend.calls.borrow(), ["projects"]);
    }

    fn listed(dir: &Path, id: &str) -> Value {
        json!([{ "name": "work", "path": dir, "diagrams": [{ "id": id, "title": "T" }] }])
    }

    #[test]
    fn a_file_in_a_project_opens_in_place_only_when_the_service_lists_it() {
        let dir = tempfile::tempdir().unwrap();
        let file = write(dir.path(), "flow.openflow.json", r#"{"id":"abc"}"#);
        let backend = fake_with(listed(dir.path(), "abc"));
        assert_eq!(resolve(ORIGIN, &file, &backend).unwrap(), "http://127.0.0.1:43120/#/p/work/abc");
    }

    #[test]
    fn an_upper_case_suffix_the_service_does_not_scan_is_imported() {
        let dir = tempfile::tempdir().unwrap();
        let file = write(dir.path(), "A.OpenFlow.JSON", r#"{"id":"abc"}"#);
        let backend = fake_with(json!([{ "name": "work", "path": dir.path(), "diagrams": [] }]));
        assert_eq!(resolve(ORIGIN, &file, &backend).unwrap(), format!("{ORIGIN}/#/p/{SCRATCH}/new-id"));
        assert_eq!(*backend.calls.borrow(), ["projects", "create scratch A", "save scratch new-id"]);
    }

    #[test]
    fn an_id_the_listing_does_not_contain_is_imported() {
        let dir = tempfile::tempdir().unwrap();
        let file = write(dir.path(), "a.openflow.json", r#"{"id":"abc"}"#);
        let backend = fake_with(listed(dir.path(), "other"));
        assert_eq!(resolve(ORIGIN, &file, &backend).unwrap(), format!("{ORIGIN}/#/p/{SCRATCH}/new-id"));
        assert_eq!(backend.calls.borrow().len(), 3);
    }

    #[test]
    fn two_files_sharing_an_id_are_both_imported() {
        let dir = tempfile::tempdir().unwrap();
        let first = write(dir.path(), "first.openflow.json", r#"{"id":"abc"}"#);
        let second = write(dir.path(), "second.openflow.json", r#"{"id":"abc"}"#);
        write(dir.path(), "other.openflow.json", r#"{"id":"zzz"}"#);
        let projects = json!([{ "name": "work", "path": dir.path(), "diagrams": [{ "id": "abc", "title": "T", "modifiedAt": 1, "holder": null }] }]);
        for file in [&first, &second] {
            let backend = fake_with(projects.clone());
            assert_eq!(resolve(ORIGIN, file, &backend).unwrap(), format!("{ORIGIN}/#/p/{SCRATCH}/new-id"));
            assert_eq!(*backend.calls.borrow(), ["projects".to_string(), format!("create scratch {}", files::title(file)), "save scratch new-id".to_string()]);
        }
    }

    #[test]
    fn a_unique_id_beside_other_diagrams_opens_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let file = write(dir.path(), "a.openflow.json", r#"{"id":"abc"}"#);
        write(dir.path(), "b.openflow.json", r#"{"id":"def"}"#);
        write(dir.path(), "notes.json", r#"{"id":"abc"}"#);
        write(dir.path(), "broken.openflow.json", "not json");
        let backend = fake_with(listed(dir.path(), "abc"));
        assert_eq!(resolve(ORIGIN, &file, &backend).unwrap(), "http://127.0.0.1:43120/#/p/work/abc");
    }

    #[test]
    fn project_matching_goes_by_real_path() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real");
        fs::create_dir(&real).unwrap();
        #[cfg(unix)]
        {
            let link = dir.path().join("link");
            std::os::unix::fs::symlink(&real, &link).unwrap();
            let file = write(&real, "a.openflow.json", r#"{"id":"x"}"#);
            let backend = fake_with(json!([{ "name": "linked", "path": link, "diagrams": [{ "id": "x" }] }]));
            assert_eq!(resolve(ORIGIN, &file, &backend).unwrap(), "http://127.0.0.1:43120/#/p/linked/x");
        }
    }

    #[test]
    fn ids_and_projects_are_encoded_in_the_route() {
        let dir = tempfile::tempdir().unwrap();
        let file = write(dir.path(), "a.openflow.json", r#"{"id":"a b/c"}"#);
        let backend = fake_with(json!([{ "name": "my proj", "path": dir.path(), "diagrams": [{ "id": "a b/c" }] }]));
        assert_eq!(resolve(ORIGIN, &file, &backend).unwrap(), "http://127.0.0.1:43120/#/p/my%20proj/a%20b%2Fc");
    }

    #[test]
    fn a_file_outside_every_project_is_imported_into_scratch_under_a_new_id() {
        let (project, elsewhere) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let file = write(elsewhere.path(), "other.openflow.json", r#"{"id":"old","name":"  Mine ","nodes":[1,2]}"#);
        let backend = fake_with(json!([{ "name": "work", "path": project.path() }, { "name": "scratch", "path": "/nowhere/scratch" }]));
        assert_eq!(resolve(ORIGIN, &file, &backend).unwrap(), format!("{ORIGIN}/#/p/{SCRATCH}/new-id"));
        assert_eq!(*backend.calls.borrow(), ["projects", "create scratch Mine", "save scratch new-id"]);
        let saved = backend.saved.borrow();
        assert_eq!(saved[0].3, 7, "the revision the create returned");
        assert_eq!(saved[0].2, json!({ "id": "new-id", "name": "  Mine ", "nodes": [1, 2] }));
    }

    #[test]
    fn an_import_without_a_name_is_titled_by_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = write(dir.path(), "Order flow.openflow.json", r#"{"id":"old"}"#);
        let backend = fake_with(json!([]));
        resolve(ORIGIN, &file, &backend).unwrap();
        assert_eq!(backend.calls.borrow()[1], "create scratch Order flow");
    }

    #[test]
    fn broken_diagram_files_are_refused_before_the_service_is_touched() {
        let dir = tempfile::tempdir().unwrap();
        let backend = fake_with(json!([]));
        for (name, text) in [("a.openflow.json", "not json"), ("b.openflow.json", "{}"), ("c.openflow.json", r#"{"id":""}"#), ("d.openflow.json", r#"{"id":5}"#), ("e.openflow.json", "[]")] {
            let file = write(dir.path(), name, text);
            assert!(resolve(ORIGIN, &file, &backend).is_err(), "{name}");
        }
        assert!(resolve(ORIGIN, &dir.path().join("missing.openflow.json"), &backend).is_err());
        assert!(backend.calls.borrow().is_empty());
    }

    #[test]
    fn dsl_text_opens_through_the_from_dsl_route_with_the_file_name_as_title() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["g.mmd", "g.openflow"] {
            let file = write(dir.path(), name, "flowchart TD\n A-->B\n");
            let backend = fake_with(json!([]));
            let url = resolve(ORIGIN, &file, &backend).unwrap();
            assert!(url.starts_with("http://127.0.0.1:43120/#/from/dsl?d="), "{url}");
            assert!(url.ends_with("&t=g"), "{url}");
            assert!(backend.calls.borrow().is_empty(), "text needs no service call");
        }
    }

    #[test]
    fn dsl_text_must_be_utf8_non_empty_and_small() {
        let dir = tempfile::tempdir().unwrap();
        let backend = fake_with(json!([]));
        fs::write(dir.path().join("bin.mmd"), [0xff, 0xfe, 0x00]).unwrap();
        assert!(resolve(ORIGIN, &dir.path().join("bin.mmd"), &backend).is_err());
        assert!(resolve(ORIGIN, &write(dir.path(), "empty.mmd", "  \n"), &backend).is_err());
        assert!(resolve(ORIGIN, &write(dir.path(), "big.mmd", &"a".repeat(dsl::MAX_BYTES + 1)), &backend).is_err());
    }

    #[test]
    fn a_byte_order_mark_is_not_part_of_the_text() {
        let dir = tempfile::tempdir().unwrap();
        let plain = resolve(ORIGIN, &write(dir.path(), "a.mmd", "graph LR\n"), &fake_with(json!([]))).unwrap();
        let marked = resolve(ORIGIN, &write(dir.path(), "a.mmd", "\u{feff}graph LR\n"), &fake_with(json!([]))).unwrap();
        assert_eq!(plain, marked);
    }

    #[test]
    fn other_files_are_refused() {
        assert!(resolve(ORIGIN, Path::new("/x/a.png"), &fake_with(json!([]))).is_err());
    }

    #[test]
    fn owner_ignores_projects_it_cannot_resolve() {
        let dir = tempfile::tempdir().unwrap();
        let projects = json!([{ "name": "gone", "path": "/does/not/exist" }, { "path": dir.path() }, { "name": "ok", "path": dir.path() }]);
        assert_eq!(owner(&projects, dir.path(), real_path), Some("ok".into()));
        assert_eq!(owner(&json!({}), dir.path(), real_path), None);
        assert_eq!(owner(&projects, Path::new("/does/not/exist"), real_path), None);
    }

    #[test]
    fn request_paths_encode_each_segment() {
        assert_eq!(create_path("my proj"), "/projects/my%20proj/diagrams");
        assert_eq!(save_path("p", "a/b"), "/projects/p/diagrams/a%2Fb");
    }

    #[test]
    fn requests_carry_the_keys_the_service_reads() {
        assert_eq!(create_request("my proj", "Flow"), ("/projects/my%20proj/diagrams".to_string(), json!({ "name": "Flow" })));
        let document = json!({ "id": "i" });
        assert_eq!(save_request("p", "i", &document, 3), ("/projects/p/diagrams/i".to_string(), json!({ "document": { "id": "i" }, "revision": 3 })));
    }

    #[test]
    fn replies_are_read_by_status() {
        assert_eq!(created(201, &json!({ "id": "n", "revision": 2 })), Ok(("n".into(), 2)));
        assert!(created(200, &json!({ "id": "n", "revision": 2 })).is_err());
        assert!(created(201, &json!({ "revision": 2 })).is_err());
        assert!(created(201, &json!({ "id": "n" })).is_err());
        assert_eq!(created(404, &json!({ "error": "no such project" })), Err("the service answered 404: no such project".into()));
        assert_eq!(saved(200, &Value::Null), Ok(()));
        assert_eq!(saved(400, &json!({ "message": "bad schema" })), Err("the service answered 400: bad schema".into()));
        assert_eq!(saved(500, &Value::Null), Err("the service answered 500".into()));
    }

    #[test]
    fn a_failed_save_opens_nothing_and_names_the_orphan() {
        let dir = tempfile::tempdir().unwrap();
        let file = write(dir.path(), "a.openflow.json", r#"{"id":"old"}"#);
        let backend = Fake { projects: json!([]), fail_save: true, ..Default::default() };
        assert_eq!(resolve(ORIGIN, &file, &backend), Err("created scratch/new-id but could not save it: boom".into()));
        assert!(backend.saved.borrow().is_empty());
    }

    #[test]
    fn with_id_replaces_only_the_id() {
        assert_eq!(with_id(&json!({ "id": "a", "x": 1 }), "b"), json!({ "id": "b", "x": 1 }));
    }
}
