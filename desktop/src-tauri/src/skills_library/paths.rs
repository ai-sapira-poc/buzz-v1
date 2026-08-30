//! Path allow-listing for the skills library and the eval contract.
//!
//! Every command in this module operates on files the app owns. None of them
//! accepts an arbitrary filesystem path: a caller-supplied path is resolved,
//! canonicalized, and checked against an explicit list of roots before a single
//! byte is read or written. See `docs/spec-agent-profile.md` §7.
//!
//! Two lists, deliberately asymmetric:
//!
//! - **Managed roots** — read *and* write. The nest's own skill and eval
//!   directories, and nothing else.
//! - **Import roots** — read only. The places a user's existing skills already
//!   live, plus whatever directory the user picked in the system dialog for one
//!   import. A user's explicit pick is what authorizes that root, and it
//!   authorizes it for that operation alone.

use std::path::{Path, PathBuf};

/// Directory holding the canonical skills, relative to the nest root.
pub const CANONICAL_SKILLS_REL: &str = ".agents/skills";
/// Directory holding per-agent evals, relative to the nest root.
pub const EVALS_REL: &str = ".agents/evals";

/// Runtime skill directories that get a symlink per skill.
///
/// Mirrors `managed_agents::discovery::known_skill_dirs()` for the runtimes
/// that declare one. Kept as a literal here so the library keeps working if
/// the runtime catalog is filtered by feature flags: an extra symlink is
/// harmless, a missing one makes a skill invisible to a runtime.
pub const RUNTIME_SKILL_DIRS: &[&str] = &[".claude/skills", ".goose/skills"];

/// Import roots that are always readable without an explicit user pick.
const STANDING_IMPORT_RELS: &[&str] = &[".agents/skills", ".claude/skills", ".goose/skills"];

/// Where the library reads and writes. Resolved once per call rather than
/// cached, so tests can point it at a temp dir.
#[derive(Clone, Debug)]
pub struct LibraryRoots {
    /// The agent nest — `~/.buzz`, or `~/.buzz-dev` in dev builds.
    pub nest: PathBuf,
    /// The user's real home. Source of the standing import roots.
    pub home: PathBuf,
}

impl LibraryRoots {
    pub fn new(nest: PathBuf, home: PathBuf) -> Self {
        Self { nest, home }
    }

    /// Production resolution: the nest that managed agents actually run in,
    /// and the user's home.
    pub fn from_env() -> Result<Self, String> {
        let nest = crate::managed_agents::default_agent_workdir()
            .ok_or_else(|| "could not resolve the agent nest directory".to_string())?;
        let home =
            dirs::home_dir().ok_or_else(|| "could not resolve the home directory".to_string())?;
        Ok(Self::new(nest, home))
    }

    pub fn skills_dir(&self) -> PathBuf {
        self.nest.join(CANONICAL_SKILLS_REL)
    }

    pub fn evals_dir(&self) -> PathBuf {
        self.nest.join(EVALS_REL)
    }

    pub fn skill_dir(&self, name: &str) -> PathBuf {
        self.skills_dir().join(name)
    }

    /// Runtime symlink locations for one skill, in `known_skill_dirs()` order.
    pub fn runtime_links(&self, name: &str) -> Vec<(PathBuf, String)> {
        RUNTIME_SKILL_DIRS
            .iter()
            .map(|rel| {
                let link = self.nest.join(rel).join(name);
                // Relative target, matching `ensure_skill_symlinks`: a nest that
                // moves keeps working.
                let depth = Path::new(rel).components().count();
                let target = format!("{}{CANONICAL_SKILLS_REL}/{name}", "../".repeat(depth));
                (link, target)
            })
            .collect()
    }

    /// Roots the library may read *and* write.
    pub fn managed_roots(&self) -> Vec<PathBuf> {
        let mut roots = vec![self.skills_dir(), self.evals_dir()];
        for rel in RUNTIME_SKILL_DIRS {
            roots.push(self.nest.join(rel));
        }
        roots
    }

    /// Roots the library may read as an import source, without a user pick.
    pub fn standing_import_roots(&self) -> Vec<PathBuf> {
        let mut roots = self.managed_roots();
        for rel in STANDING_IMPORT_RELS {
            roots.push(self.home.join(rel));
        }
        roots
    }
}

/// Why a path was refused. Callers surface the message; the variant exists so
/// tests can assert the reason rather than string-matching.
#[derive(Debug, PartialEq, Eq)]
pub enum PathDenied {
    /// Resolved cleanly but landed outside every allowed root.
    OutsideRoots,
    /// Could not be resolved at all (missing, or unreadable).
    Unresolvable,
    /// Contains a `..` or other non-normal component before resolution.
    Traversal,
}

impl PathDenied {
    pub fn message(&self, path: &Path) -> String {
        match self {
            Self::OutsideRoots => format!(
                "{} is outside the directories Buzz manages for skills and evals",
                path.display()
            ),
            Self::Unresolvable => format!("{} could not be resolved", path.display()),
            Self::Traversal => format!("{} contains a path traversal", path.display()),
        }
    }
}

/// Canonicalize `candidate` and require it to sit inside one of `roots`.
///
/// Canonicalization is what makes this safe rather than cosmetic: `..` is
/// resolved away and a symlink that escapes the root resolves to its real
/// target, which then fails the containment check. A prefix check on the raw
/// string would pass both.
///
/// The path must exist. Callers creating a new file check its *parent*.
pub fn resolve_within(candidate: &Path, roots: &[PathBuf]) -> Result<PathBuf, PathDenied> {
    if candidate
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(PathDenied::Traversal);
    }

    let resolved = candidate
        .canonicalize()
        .map_err(|_| PathDenied::Unresolvable)?;

    for root in roots {
        // A root that does not exist yet cannot contain anything; skip it
        // rather than failing the whole check.
        let Ok(root_resolved) = root.canonicalize() else {
            continue;
        };
        if resolved == root_resolved || resolved.starts_with(&root_resolved) {
            return Ok(resolved);
        }
    }

    Err(PathDenied::OutsideRoots)
}

/// Same containment rule, for a path that does not exist yet: the *parent*
/// must resolve inside a root, and the final component must be a plain name.
pub fn resolve_new_within(candidate: &Path, roots: &[PathBuf]) -> Result<PathBuf, PathDenied> {
    let parent = candidate.parent().ok_or(PathDenied::Unresolvable)?;
    let file_name = candidate
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or(PathDenied::Unresolvable)?;
    if file_name == "." || file_name == ".." || file_name.contains('/') {
        return Err(PathDenied::Traversal);
    }
    let parent_resolved = resolve_within(parent, roots)?;
    Ok(parent_resolved.join(file_name))
}

/// Resolve an import source directory: allowed if it sits under a standing
/// import root, or under the directory the user just picked.
pub fn resolve_import_source(
    candidate: &Path,
    roots: &LibraryRoots,
    user_picked: Option<&Path>,
) -> Result<PathBuf, PathDenied> {
    let mut allowed = roots.standing_import_roots();
    if let Some(picked) = user_picked {
        allowed.push(picked.to_path_buf());
    }
    resolve_within(candidate, &allowed)
}
