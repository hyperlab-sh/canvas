//! Which files the app opens, and where they come from (argv, a drop, the OS's opened-file event).
//! `.openflow.json` is a saved diagram; `.openflow` and `.mmd` are text the editor's `#/from/dsl` route reads
//! (OpenFlow DSL, or Mermaid converted on open).

use std::path::{Path, PathBuf};

use tauri::Url;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Kind {
    /// A saved diagram document.
    Diagram,
    /// Diagram text for the DSL route.
    Dsl,
}

/// Suffixes the app opens, longest first so `.openflow.json` is not read as a `.json` file.
const SUFFIXES: [(&str, Kind); 3] = [(".openflow.json", Kind::Diagram), (".openflow", Kind::Dsl), (".mmd", Kind::Dsl)];

/// The kind and the length of the name before the suffix. ASCII suffixes only, so the byte length of the
/// suffix is the same in the original name as in its lowercased copy.
fn matched(path: &Path) -> Option<(Kind, usize)> {
    let name = path.file_name()?.to_str()?;
    SUFFIXES.iter().find_map(|(suffix, kind)| {
        let stem_len = name.len().checked_sub(suffix.len()).filter(|len| *len > 0)?;
        let tail = name.get(stem_len..)?;
        tail.eq_ignore_ascii_case(suffix).then_some((*kind, stem_len))
    })
}

pub fn kind(path: &Path) -> Option<Kind> {
    matched(path).map(|(kind, _)| kind)
}

/// The file's name without its diagram suffix: the title a new diagram gets.
pub fn title(path: &Path) -> String {
    match (matched(path), path.file_name().and_then(|name| name.to_str())) {
        (Some((_, stem_len)), Some(name)) => name[..stem_len].to_string(),
        _ => String::new(),
    }
}

/// The openable files among launch arguments. Flags, `canvas://` links (the deep-link plugin takes those),
/// and files of any other kind are skipped, so an arbitrary argument cannot make the app read a file.
/// `file://` arguments are mapped to paths: GIO expands the desktop entry's `%U` to URIs on Linux.
pub fn from_args(args: impl IntoIterator<Item = String>) -> Vec<PathBuf> {
    args.into_iter()
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| match Url::parse(&arg) {
            Ok(url) if url.scheme() == "file" => url.to_file_path().ok(),
            _ if arg.contains("://") => None,
            _ => Some(PathBuf::from(arg)),
        })
        .filter(|path| kind(path).is_some())
        .collect()
}

/// Like `from_args`, for a launch from another working directory: relative paths are taken from `cwd`.
pub fn from_args_in(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<PathBuf> {
    from_args(args).into_iter().map(|path| if path.is_absolute() { path } else { cwd.join(path) }).collect()
}

/// The openable files among opened-file URLs (macOS hands the app `file://` URLs).
pub fn from_urls<'a>(urls: impl IntoIterator<Item = &'a Url>) -> Vec<PathBuf> {
    urls.into_iter()
        .filter(|url| url.scheme() == "file")
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| kind(path).is_some())
        .collect()
}

/// The openable files among dropped paths.
pub fn from_paths(paths: &[PathBuf]) -> Vec<PathBuf> {
    paths.iter().filter(|path| kind(path).is_some()).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(text: &str) -> PathBuf {
        PathBuf::from(text)
    }

    #[test]
    fn classifies_by_suffix() {
        assert_eq!(kind(&p("/x/a.openflow.json")), Some(Kind::Diagram));
        assert_eq!(kind(&p("/x/a.openflow")), Some(Kind::Dsl));
        assert_eq!(kind(&p("/x/a.mmd")), Some(Kind::Dsl));
        assert_eq!(kind(&p("/x/A.OpenFlow.JSON")), Some(Kind::Diagram));
        assert_eq!(kind(&p("/x/dotted.name.mmd")), Some(Kind::Dsl));
    }

    #[test]
    fn rejects_everything_else() {
        for other in ["/x/a.json", "/x/a.txt", "/x/a.openflow.json.bak", "/x/.mmd", "/x/.openflow.json", "/x/mmd", "/x/", ""] {
            assert_eq!(kind(&p(other)), None, "{other:?}");
        }
    }

    #[test]
    fn title_drops_the_suffix_only() {
        assert_eq!(title(&p("/x/My Flow.openflow.json")), "My Flow");
        assert_eq!(title(&p("/x/v1.2.mmd")), "v1.2");
        assert_eq!(title(&p("/x/A.OPENFLOW")), "A");
        assert_eq!(title(&p("/x/a.txt")), "");
    }

    #[test]
    fn title_handles_multibyte_names() {
        assert_eq!(title(&p("/x/café.mmd")), "café");
        assert_eq!(title(&p("/x/İstanbul.MMD")), "İstanbul");
        // A multibyte character straddling the cut must not panic.
        assert_eq!(kind(&p("/x/ééé")), None);
        assert_eq!(kind(&p("/x/éé.mm")), None);
    }

    #[test]
    fn args_keep_only_openable_files() {
        let args = ["--smoke", "canvas://open/p/i", "/x/a.mmd", "/etc/passwd", "-psn_0_1", "b.openflow.json", "http://x/a.mmd"].map(String::from);
        assert_eq!(from_args(args), vec![p("/x/a.mmd"), p("b.openflow.json")]);
    }

    #[test]
    fn file_url_args_become_paths() {
        let args = ["file:///x/a%20b.openflow.json", "file:///x/a.png", "canvas://open/p/i", "http://x/a.mmd", "file:///x/c.mmd"].map(String::from);
        assert_eq!(from_args(args), vec![p("/x/a b.openflow.json"), p("/x/c.mmd")]);
    }

    #[test]
    fn file_url_args_stay_absolute_in_a_directory() {
        let args = ["file:///x/a%20b.openflow.json", "file:///x/a.png", "canvas://open/p/i", "http://x/a.mmd", "rel.mmd"].map(String::from);
        assert_eq!(from_args_in(args, Path::new("/work")), vec![p("/x/a b.openflow.json"), p("/work/rel.mmd")]);
    }

    #[test]
    fn args_in_a_directory_resolve_relative_paths_against_it() {
        let args = ["/x/a.mmd", "b.openflow.json", "sub/c.openflow", "-f", "d.txt"].map(String::from);
        assert_eq!(from_args_in(args, Path::new("/work")), vec![p("/x/a.mmd"), p("/work/b.openflow.json"), p("/work/sub/c.openflow")]);
    }

    #[test]
    fn urls_keep_only_openable_file_urls() {
        let urls: Vec<Url> = ["file:///x/a.openflow.json", "file:///x/a.png", "canvas://open/p/i", "http://x/a.mmd", "file:///x/sp%20ace.mmd"]
            .iter()
            .map(|text| Url::parse(text).unwrap())
            .collect();
        assert_eq!(from_urls(&urls), vec![p("/x/a.openflow.json"), p("/x/sp ace.mmd")]);
    }

    #[test]
    fn drops_keep_only_openable_paths() {
        assert_eq!(from_paths(&[p("/x/a.mmd"), p("/x/a.png"), p("/x/dir")]), vec![p("/x/a.mmd")]);
    }
}
