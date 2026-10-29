//! Where a download lands: the OS Downloads folder, never overwriting an existing file.

use std::path::{Path, PathBuf};

/// The requested file's own name, without any directory part the webview's default destination carries.
fn base_name(requested: &Path) -> String {
    requested
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty() && name != "." && name != "..")
        .unwrap_or_else(|| "download".into())
}

/// `dir/name`, or `dir/stem (1).ext`, `dir/stem (2).ext`, ... when taken. `exists` is injectable for tests.
pub fn destination(dir: &Path, requested: &Path, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let name = base_name(requested);
    let first = dir.join(&name);
    if !exists(&first) {
        return first;
    }
    let as_path = Path::new(&name);
    // `.openflow.json` style double extensions keep only the last: "a.openflow (1).json" is still openable.
    let stem = as_path.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_else(|| name.clone());
    let extension = as_path.extension().map(|extension| format!(".{}", extension.to_string_lossy())).unwrap_or_default();
    (1u32..)
        .map(|n| dir.join(format!("{stem} ({n}){extension}")))
        .find(|candidate| !exists(candidate))
        .expect("an unused name exists")
}

/// The OS Downloads folder (`resolved` from the platform), else `~/Downloads`. Only a path: nothing is touched
/// until a download happens, because macOS asks for Downloads access on first use and a launch must not.
pub fn downloads_path(resolved: Option<PathBuf>) -> Option<PathBuf> {
    resolved.or_else(|| {
        let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
        Some(PathBuf::from(home).join("Downloads"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn taken(names: &[&str]) -> impl Fn(&Path) -> bool {
        let set: HashSet<PathBuf> = names.iter().map(|name| Path::new("/d").join(name)).collect();
        move |path| set.contains(path)
    }

    #[test]
    fn free_names_are_kept() {
        assert_eq!(destination(Path::new("/d"), Path::new("diagram.png"), taken(&[])), Path::new("/d/diagram.png"));
    }

    #[test]
    fn directory_part_of_the_default_destination_is_dropped() {
        assert_eq!(destination(Path::new("/d"), Path::new("/somewhere/else/diagram.png"), taken(&[])), Path::new("/d/diagram.png"));
        assert_eq!(destination(Path::new("/d"), Path::new("../../etc/x.svg"), taken(&[])), Path::new("/d/x.svg"));
    }

    #[test]
    fn taken_names_get_a_counter_before_the_extension() {
        assert_eq!(destination(Path::new("/d"), Path::new("a.png"), taken(&["a.png"])), Path::new("/d/a (1).png"));
        assert_eq!(destination(Path::new("/d"), Path::new("a.png"), taken(&["a.png", "a (1).png", "a (2).png"])), Path::new("/d/a (3).png"));
    }

    #[test]
    fn a_name_without_extension_gets_a_plain_counter() {
        assert_eq!(destination(Path::new("/d"), Path::new("README"), taken(&["README"])), Path::new("/d/README (1)"));
    }

    #[test]
    fn dotfiles_and_double_extensions() {
        assert_eq!(destination(Path::new("/d"), Path::new(".env"), taken(&[".env"])), Path::new("/d/.env (1)"));
        assert_eq!(destination(Path::new("/d"), Path::new("x.openflow.json"), taken(&["x.openflow.json"])), Path::new("/d/x.openflow (1).json"));
    }

    #[test]
    fn empty_or_dot_names_become_download() {
        for requested in ["", ".", "..", "/"] {
            assert_eq!(destination(Path::new("/d"), Path::new(requested), taken(&[])), Path::new("/d/download"), "{requested:?}");
        }
    }

    #[test]
    fn unicode_names_survive() {
        assert_eq!(destination(Path::new("/d"), Path::new("diagrama ação.png"), taken(&["diagrama ação.png"])), Path::new("/d/diagrama ação (1).png"));
    }

    #[test]
    fn checks_the_real_filesystem_when_asked() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.png"), b"x").unwrap();
        let path = destination(dir.path(), Path::new("a.png"), |p| p.exists());
        assert_eq!(path, dir.path().join("a (1).png"));
    }

    #[test]
    fn downloads_path_prefers_the_platform_folder_and_touches_nothing() {
        let root = tempfile::tempdir().unwrap();
        let wanted = root.path().join("Downloads");
        assert_eq!(downloads_path(Some(wanted.clone())), Some(wanted.clone()));
        assert!(!wanted.exists());
    }
}
