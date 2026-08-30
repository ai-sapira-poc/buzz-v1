//! Detects bundled sidecars that were stubbed rather than built.
//!
//! `just desktop-release-build` creates the six sidecar files with `touch` so
//! the bundler has something to embed; CI replaces them with real binaries.
//! A local build therefore ships zero-byte sidecars, and every agent feature
//! fails at the moment of use, with an error that looks like a product bug
//! rather than a build one.
//!
//! Compiling them for real costs 15–25 minutes and several GB per build, which
//! is not worth paying on every local build. Saying so out loud at startup
//! costs nothing and removes almost all of the confusion.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// Sidecars declared in `bundle.externalBin`, without the target-triple suffix
/// the bundler strips when it installs them next to the executable.
const SIDECARS: &[&str] = &[
    "buzz",
    "buzz-acp",
    "buzz-agent",
    "buzz-backend-kubernetes",
    "buzz-dev-mcp",
    "git-credential-nostr",
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SidecarHealth {
    /// Names of sidecars present but empty. Empty vec means nothing to report.
    pub stubbed: Vec<String>,
    /// Whether the check could run at all — false when the directory is absent,
    /// which is normal in `tauri dev` and must not be reported as a problem.
    pub checked: bool,
}

/// Classify the sidecars sitting in `dir`.
///
/// A missing file is not reported: dev runs resolve sidecars from the workspace
/// instead of the bundle, so absence is expected there. Only a *present but
/// empty* file is a stub, and that is unambiguous — a real binary is megabytes.
pub fn inspect_sidecars(dir: &Path) -> SidecarHealth {
    if !dir.is_dir() {
        return SidecarHealth {
            stubbed: Vec::new(),
            checked: false,
        };
    }

    let mut stubbed = Vec::new();
    for name in SIDECARS {
        let path = dir.join(name);
        if let Ok(meta) = std::fs::metadata(&path) {
            if meta.is_file() && meta.len() == 0 {
                stubbed.push((*name).to_string());
            }
        }
    }
    stubbed.sort();

    SidecarHealth {
        stubbed,
        checked: true,
    }
}

/// Directory the bundler installs sidecars into: alongside the executable.
fn bundled_sidecar_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()?
        .parent()
        .map(std::path::Path::to_path_buf)
}

#[tauri::command]
pub fn get_sidecar_health() -> SidecarHealth {
    match bundled_sidecar_dir() {
        Some(dir) => inspect_sidecars(&dir),
        None => SidecarHealth {
            stubbed: Vec::new(),
            checked: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tempdir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "buzz-sidecar-health-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn reports_nothing_when_the_directory_is_absent() {
        let health = inspect_sidecars(Path::new("/nonexistent/buzz/sidecars"));
        assert!(!health.checked, "an absent directory is not a verdict");
        assert!(health.stubbed.is_empty());
    }

    #[test]
    fn a_missing_sidecar_is_not_a_stub() {
        // Dev runs resolve from the workspace, so absence is expected there.
        let dir = tempdir();
        let health = inspect_sidecars(&dir);
        assert!(health.checked);
        assert!(health.stubbed.is_empty());
    }

    #[test]
    fn flags_only_the_empty_ones() {
        let dir = tempdir();
        std::fs::File::create(dir.join("buzz-agent")).expect("stub");
        let mut real = std::fs::File::create(dir.join("buzz-acp")).expect("real");
        real.write_all(b"not empty").expect("write");

        let health = inspect_sidecars(&dir);
        assert_eq!(health.stubbed, vec!["buzz-agent".to_string()]);
    }

    #[test]
    fn reports_every_stub_sorted() {
        let dir = tempdir();
        for name in ["buzz-dev-mcp", "buzz", "buzz-agent"] {
            std::fs::File::create(dir.join(name)).expect("stub");
        }
        let health = inspect_sidecars(&dir);
        assert_eq!(
            health.stubbed,
            vec![
                "buzz".to_string(),
                "buzz-agent".to_string(),
                "buzz-dev-mcp".to_string()
            ],
        );
    }

    #[test]
    fn ignores_files_that_are_not_declared_sidecars() {
        let dir = tempdir();
        std::fs::File::create(dir.join("some-other-empty-file")).expect("stub");
        assert!(inspect_sidecars(&dir).stubbed.is_empty());
    }
}
