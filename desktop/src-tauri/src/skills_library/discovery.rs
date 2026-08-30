//! Skill discovery, reproducing what a runtime would actually see.
//!
//! This mirrors `crates/buzz-agent/src/hints.rs` deliberately rather than
//! calling it: `hints.rs` returns a `SkillEntry` shaped for prompt building and
//! silently drops everything malformed. The profile needs the opposite — the
//! full picture, including the skills the runtime would throw away and the ones
//! it would shadow. See `docs/spec-agent-profile.md` §1.2 and §6.1.
//!
//! When the two ever disagree about *order*, `hints.rs` wins; the unit test
//! `discovery_order_matches_hints_constant` pins the list.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::contract::{parse_skill_dir, ParsedSkill};
use super::paths::LibraryRoots;

/// Discovery directories scanned relative to the agent's `cwd`, in the order
/// `hints::SKILL_DIRS` declares them. The order decides who wins a name
/// collision, so it is not cosmetic.
pub const CWD_SKILL_DIRS: &[&str] = &[".agents/skills", ".goose/skills", ".claude/skills"];

/// Where a discovered skill came from, in the terms the profile shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillScope {
    /// Under the agent nest — `~/.buzz/...`. Written by Buzz, global to every
    /// managed agent on this machine (§1.1).
    Nest,
    /// `~/.agents/skills` — outside the nest, still global to the machine.
    MachineGlobal,
    /// A runtime's own directory that Buzz does not manage, e.g. the user's
    /// `~/.claude/skills`. Only that runtime sees it.
    RuntimeOwned,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSkill {
    #[serde(flatten)]
    pub skill: ParsedSkill,
    pub scope: SkillScope,
    /// The discovery directory this came from, e.g. `.agents/skills`.
    pub source_dir: String,
    /// True when an earlier directory already claimed this name, so the runtime
    /// discards this copy without a word (`hints.rs:136`).
    pub shadowed: bool,
    /// The `source_dir` of the skill that shadows this one.
    pub shadowed_by: Option<String>,
}

/// Everything one runtime would see, in resolution order.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSkillView {
    pub runtime_id: String,
    /// Absolute `cwd` the agent runs in — the nest, for every managed agent.
    pub cwd: String,
    pub skills: Vec<DiscoveredSkill>,
    /// Directories scanned, in order, whether or not they existed.
    pub scanned: Vec<ScannedDir>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedDir {
    pub path: String,
    pub label: String,
    pub scope: SkillScope,
    pub exists: bool,
}

/// One scan target, resolved.
struct ScanTarget {
    path: PathBuf,
    label: String,
    scope: SkillScope,
}

/// Build the ordered scan list for a runtime.
///
/// `buzz-agent` and `codex` scan `cwd` for all three directories plus
/// `~/.agents/skills`. `claude` and `goose` do the same through the nest
/// symlinks, and `claude` additionally reads the user's own `~/.claude/skills`,
/// which Buzz does not manage (§1.3).
fn scan_targets(runtime_id: &str, roots: &LibraryRoots) -> Vec<ScanTarget> {
    let mut targets: Vec<ScanTarget> = CWD_SKILL_DIRS
        .iter()
        .map(|rel| ScanTarget {
            path: roots.nest.join(rel),
            label: rel.to_string(),
            scope: SkillScope::Nest,
        })
        .collect();

    targets.push(ScanTarget {
        path: roots.home.join(".agents/skills"),
        label: "~/.agents/skills".to_string(),
        scope: SkillScope::MachineGlobal,
    });

    // The runtime's own user-level directory, outside the nest. Only `claude`
    // and `goose` have one; `buzz-agent` and `codex` do not read anything of
    // the sort.
    let runtime_owned = match runtime_id {
        "claude" => Some(".claude/skills"),
        "goose" => Some(".goose/skills"),
        _ => None,
    };
    if let Some(rel) = runtime_owned {
        let path = roots.home.join(rel);
        // Skip when home *is* the nest: it is already in the list above and
        // would double-count.
        if path != roots.nest.join(rel) {
            targets.push(ScanTarget {
                path,
                label: format!("~/{rel}"),
                scope: SkillScope::RuntimeOwned,
            });
        }
    }

    targets
}

/// Read one directory's immediate subdirectories that contain a `SKILL.md`.
fn scan_dir(dir: &Path) -> Vec<ParsedSkill> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut subdirs: Vec<PathBuf> = entries
        .flatten()
        // `std::fs::metadata` follows symlinks; `DirEntry::file_type` does not,
        // and every runtime link in the nest is a symlink. Using the wrong one
        // makes every symlinked skill invisible — the same trap `hints.rs`
        // documents.
        .filter(|e| {
            std::fs::metadata(e.path())
                .map(|m| m.is_dir())
                .unwrap_or(false)
        })
        .map(|e| e.path())
        .collect();
    subdirs.sort();

    subdirs
        .iter()
        .filter(|d| d.join("SKILL.md").exists())
        .filter_map(|d| parse_skill_dir(d).ok())
        .collect()
}

/// What `runtime_id` would discover, with shadowing made explicit.
pub fn runtime_skill_view(runtime_id: &str, roots: &LibraryRoots) -> RuntimeSkillView {
    let targets = scan_targets(runtime_id, roots);
    let mut seen: HashSet<String> = HashSet::new();
    let mut claimed_by: Vec<(String, String)> = Vec::new();
    let mut skills = Vec::new();
    let mut scanned = Vec::new();

    for target in &targets {
        let exists = target.path.is_dir();
        scanned.push(ScannedDir {
            path: target.path.to_string_lossy().to_string(),
            label: target.label.clone(),
            scope: target.scope,
            exists,
        });
        if !exists {
            continue;
        }

        for skill in scan_dir(&target.path) {
            // A skill with no `name` never claims a name — the runtime drops it
            // before dedup. It is still listed, marked undiscoverable.
            let shadowed = skill.discoverable && seen.contains(&skill.name);
            let shadowed_by = if shadowed {
                claimed_by
                    .iter()
                    .find(|(name, _)| name == &skill.name)
                    .map(|(_, dir)| dir.clone())
            } else {
                None
            };
            if skill.discoverable && !shadowed {
                seen.insert(skill.name.clone());
                claimed_by.push((skill.name.clone(), target.label.clone()));
            }
            skills.push(DiscoveredSkill {
                skill,
                scope: target.scope,
                source_dir: target.label.clone(),
                shadowed,
                shadowed_by,
            });
        }
    }

    RuntimeSkillView {
        runtime_id: runtime_id.to_string(),
        cwd: roots.nest.to_string_lossy().to_string(),
        skills,
        scanned,
    }
}

/// One entry of the global inventory the Skills library lists.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySkill {
    #[serde(flatten)]
    pub skill: ParsedSkill,
    /// Runtime ids that would see this skill, given the symlinks on disk.
    pub visible_to: Vec<String>,
    /// True when the runtime symlinks for this skill are all present.
    pub links_complete: bool,
    /// Runtime directories that should hold a link for this skill but do not.
    pub missing_links: Vec<String>,
}

/// Runtimes the library reports on. Ordered for stable display.
pub const LIBRARY_RUNTIMES: &[&str] = &["buzz-agent", "codex", "claude", "goose"];

/// The canonical inventory: every skill in `~/.buzz/.agents/skills`, with the
/// runtimes that can currently reach it.
pub fn library_inventory(roots: &LibraryRoots) -> Vec<LibrarySkill> {
    scan_dir(&roots.skills_dir())
        .into_iter()
        .map(|skill| {
            let mut missing_links = Vec::new();
            for (link, _) in roots.runtime_links(&skill.dir_name) {
                if link.symlink_metadata().is_err() {
                    missing_links.push(link.to_string_lossy().to_string());
                }
            }
            // Everything in the canonical directory is reachable from `cwd` for
            // every runtime, because `.agents/skills` is scanned first and by
            // all of them. The runtime links matter for tools that only look at
            // their own directory.
            let visible_to = LIBRARY_RUNTIMES.iter().map(|r| r.to_string()).collect();
            LibrarySkill {
                links_complete: missing_links.is_empty(),
                missing_links,
                visible_to,
                skill,
            }
        })
        .collect()
}
