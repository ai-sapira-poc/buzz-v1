//! Build identity surfaced to the UI.
//!
//! Two builds of this app look identical — same name, same icon, same version
//! string — so a stale one left in the foreground is indistinguishable from a
//! fresh one. That has cost a manual verification round. These values, baked in
//! by `build.rs`, make "is this the build I just made?" answerable in seconds.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    /// Package version, e.g. `0.5.20`.
    pub version: String,
    /// Short commit hash, or `unknown` outside a git checkout.
    pub git_sha: String,
    /// Whether the working tree had uncommitted changes at build time.
    pub git_dirty: bool,
    /// Unix seconds when the binary was compiled.
    pub built_at: u64,
    /// Cargo profile: `debug` or `release`.
    pub profile: String,
    /// True for anything that is not a release build — the UI leans on this to
    /// mark the window, so it must not be inferred from the version string.
    pub is_dev: bool,
}

/// Read the values `build.rs` baked in.
///
/// Kept separate from the command so it is testable without a Tauri app handle.
pub fn build_info(version: String) -> BuildInfo {
    let profile = env!("BUZZ_BUILD_PROFILE").to_string();
    BuildInfo {
        version,
        git_sha: env!("BUZZ_GIT_SHA").to_string(),
        git_dirty: env!("BUZZ_GIT_DIRTY") == "true",
        // A malformed stamp becomes 0, which the UI renders as "unknown"
        // rather than a misleading 1970 date.
        built_at: env!("BUZZ_BUILD_TIME").parse().unwrap_or(0),
        is_dev: profile != "release",
        profile,
    }
}

#[tauri::command]
pub fn get_build_info(app: tauri::AppHandle) -> BuildInfo {
    build_info(app.package_info().version.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_version_it_was_given() {
        assert_eq!(build_info("1.2.3".into()).version, "1.2.3");
    }

    #[test]
    fn carries_the_baked_in_commit_and_profile() {
        let info = build_info("0".into());
        assert!(!info.git_sha.is_empty(), "sha must never be empty");
        assert!(
            !info.profile.is_empty(),
            "profile must never be empty — the UI keys the dev marker off it",
        );
    }

    #[test]
    fn is_dev_is_derived_from_the_profile_not_the_version() {
        // Tests compile under the `debug` profile, so this build is dev.
        let info = build_info("9.9.9".into());
        assert_eq!(info.is_dev, info.profile != "release");
        assert!(info.is_dev, "a test binary is never a release build");
    }

    #[test]
    fn serialises_as_camel_case_for_the_renderer() {
        let json = serde_json::to_string(&build_info("1.0.0".into())).expect("serialise");
        assert!(json.contains("\"gitSha\""));
        assert!(json.contains("\"builtAt\""));
        assert!(json.contains("\"isDev\""));
    }
}
