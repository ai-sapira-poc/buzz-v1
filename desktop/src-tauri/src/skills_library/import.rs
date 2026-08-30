//! The import preview: what the user confirms before anything is written.
//!
//! Import is the main path — the point of the library is migrating skills that
//! already exist in Claude Code. So the preview earns its keep by refusing to
//! be a formality: it reports every name collision and every unusable
//! description *before* the write, because both are silent failures afterwards
//! (`docs/spec-agent-profile.md` §4.1).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::contract::{parse_skill_dir, ParsedSkill};
use super::names::{description_hint, judge_description, validate_skill_name, DescriptionVerdict};
use super::paths::LibraryRoots;

/// Most skills one import may carry. A mistaken directory pick is caught here
/// rather than 900 commits later.
const MAX_IMPORT_BATCH: usize = 100;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate {
    #[serde(flatten)]
    pub skill: ParsedSkill,
    /// Absolute source directory.
    pub source: String,
    /// True when `~/.buzz/.agents/skills/<name>/` already exists.
    pub collides_with_existing: bool,
    /// True when another candidate in this same batch claims the name.
    pub collides_within_batch: bool,
    /// Set when the name itself is not importable as written.
    pub name_error: Option<String>,
    /// Suggested replacement when the name is unusable or taken.
    pub suggested_name: Option<String>,
    pub description_verdict: DescriptionVerdict,
    /// Prose shown next to a flagged description.
    pub description_hint: Option<String>,
    /// True when the user must act before this one can be imported.
    pub blocked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    /// The directory the user picked.
    pub source: String,
    /// True when the pick was one skill folder rather than a directory of them.
    pub single_skill: bool,
    pub candidates: Vec<ImportCandidate>,
    /// Set when the pick held more skills than one import may carry.
    pub truncated: Option<String>,
}

/// Suggest a free name near `name`: `name-2`, `name-3`, …
fn suggest_free_name(base: &str, roots: &LibraryRoots, taken: &HashSet<String>) -> Option<String> {
    for suffix in 2..=20u32 {
        let candidate = format!("{base}-{suffix}");
        if validate_skill_name(&candidate).is_err() {
            continue;
        }
        if taken.contains(&candidate) || roots.skill_dir(&candidate).exists() {
            continue;
        }
        return Some(candidate);
    }
    None
}

/// True when `dir` is itself a skill folder rather than a directory of them.
pub fn is_skill_dir(dir: &Path) -> bool {
    dir.join("SKILL.md").is_file()
}

/// List the skill directories an import source offers.
pub fn source_skill_dirs(source: &Path) -> Vec<PathBuf> {
    if is_skill_dir(source) {
        return vec![source.to_path_buf()];
    }
    let Ok(entries) = std::fs::read_dir(source) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| std::fs::metadata(p).map(|m| m.is_dir()).unwrap_or(false) && is_skill_dir(p))
        .collect();
    dirs.sort();
    dirs
}

/// Build the preview the confirm step renders. Reads only; writes nothing.
pub fn plan_import(source: &Path, roots: &LibraryRoots) -> ImportPreview {
    let single_skill = is_skill_dir(source);
    let mut dirs = source_skill_dirs(source);
    let truncated = if dirs.len() > MAX_IMPORT_BATCH {
        let total = dirs.len();
        dirs.truncate(MAX_IMPORT_BATCH);
        Some(format!(
            "{total} skills found; showing the first {MAX_IMPORT_BATCH}. Import in batches."
        ))
    } else {
        None
    };

    let mut seen_in_batch: HashSet<String> = HashSet::new();
    let mut candidates = Vec::new();

    for dir in dirs {
        let Ok(skill) = parse_skill_dir(&dir) else {
            continue;
        };
        // Prefer the frontmatter name; fall back to the directory name so a
        // skill with no `name` is still importable once the user supplies one.
        let proposed = skill.name.clone();
        let name_error = validate_skill_name(&proposed).err().map(|e| e.message());
        let collides_with_existing = roots.skill_dir(&proposed).exists();
        let collides_within_batch = seen_in_batch.contains(&proposed);
        if !collides_within_batch {
            seen_in_batch.insert(proposed.clone());
        }

        let verdict = judge_description(&skill.description);
        let needs_rename = name_error.is_some() || collides_with_existing || collides_within_batch;
        let suggested_name = if needs_rename {
            let base = super::names::slugify(&proposed);
            let base = if validate_skill_name(&base).is_ok() {
                base
            } else {
                "skill".to_string()
            };
            if roots.skill_dir(&base).exists()
                || seen_in_batch.contains(&base)
                || name_error.is_some()
            {
                suggest_free_name(&base, roots, &seen_in_batch)
            } else {
                Some(base)
            }
        } else {
            None
        };

        candidates.push(ImportCandidate {
            source: dir.to_string_lossy().to_string(),
            collides_with_existing,
            collides_within_batch,
            name_error,
            suggested_name,
            description_verdict: verdict,
            description_hint: description_hint(verdict).map(str::to_string),
            // A missing description blocks: importing it would put a nameless
            // line in every agent's prompt. A merely generic one warns.
            blocked: needs_rename || verdict == DescriptionVerdict::Missing,
            skill,
        });
    }

    ImportPreview {
        source: source.to_string_lossy().to_string(),
        single_skill,
        candidates,
        truncated,
    }
}
