//! Unit tests for the on-disk contract, discovery, name rules and the write
//! path. Fixtures come from `test-fixtures/agent-profile/`, so no test needs a
//! real skill directory or a real agent.
//!
//! Split by theme rather than kept in one file: the repository caps a source
//! file at 1000 lines, and this suite outgrew it. The shared harness lives
//! here; each submodule owns one part of the contract.

mod contract;
mod discovery;
mod import;
mod names;
mod paths;
mod writer;

use std::path::{Path, PathBuf};

use super::paths::LibraryRoots;
use super::writer::CommitContext;

/// `test-fixtures/agent-profile`, resolved from this crate's manifest dir.
pub(super) fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../test-fixtures/agent-profile")
        .canonicalize()
        .expect("fixtures directory must exist")
}

/// A throwaway nest: `<tmp>/.agents/skills` and the runtime link dirs.
pub(super) struct Nest {
    _dir: tempfile::TempDir,
    pub(super) roots: LibraryRoots,
}

pub(super) fn nest() -> Nest {
    let dir = tempfile::tempdir().expect("tempdir");
    // `home` is a sibling of the nest, never the nest itself. In production
    // they are always different (`~` vs `~/.buzz`), and collapsing them here
    // would make `~/.agents/skills` alias the canonical directory and quietly
    // double every count.
    let root = dir.path().join("nest");
    let home = dir.path().join("home");
    std::fs::create_dir_all(root.join(".agents/skills")).unwrap();
    std::fs::create_dir_all(root.join(".agents/evals")).unwrap();
    std::fs::create_dir_all(&home).unwrap();
    let roots = LibraryRoots::new(root, home);
    Nest { _dir: dir, roots }
}

/// git refuses to commit without an identity, and CI machines may have none.
pub(super) fn configure_git_identity(repo: &Path) {
    for args in [
        ["config", "user.email", "tests@buzz.local"],
        ["config", "user.name", "Buzz Tests"],
    ] {
        std::process::Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .expect("git config");
    }
}

pub(super) fn context(verb: &'static str, skill: &str) -> CommitContext {
    CommitContext {
        verb,
        skill: skill.to_string(),
        reason: "importada de test-fixtures".to_string(),
        agent: "Library".to_string(),
        origin: "test".to_string(),
    }
}
