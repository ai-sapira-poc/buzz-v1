//! Writing skills: canonical copy, runtime symlinks, one git commit per skill.
//!
//! The four steps and their failure policy are fixed by
//! `docs/spec-agent-profile.md` §4. Restated because it is the part that is
//! easy to get wrong: **a failure after the copy does not roll back the copy.**
//! The skill is already on disk and already visible; deleting it to keep the
//! operation "atomic" would throw away the user's work to protect a tidy
//! invariant. Failures are reported instead.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

use super::contract::{parse_skill_frontmatter, read_capped, split_frontmatter};
use super::names::validate_skill_name;
use super::paths::{resolve_new_within, resolve_within, LibraryRoots};

/// Refuse to copy a skill tree larger than this. A skill is documentation and
/// small scripts; anything at this scale is a mistaken directory pick.
const MAX_SKILL_TREE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_SKILL_TREE_FILES: usize = 500;

/// Outcome of one write, per skill.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    pub name: String,
    /// Canonical directory the skill now lives in.
    pub dir: String,
    /// Runtime symlinks created, as absolute paths.
    pub links: Vec<String>,
    /// Commit hash, when the commit succeeded.
    pub commit: Option<String>,
    /// Non-fatal failures: symlinks or git. The skill is on disk regardless.
    pub warnings: Vec<String>,
}

/// Copy a skill tree into the canonical directory.
///
/// Refuses to touch an existing destination — collisions are resolved by the
/// caller with a rename, never by overwriting (§4.3).
pub fn copy_skill_tree(source: &Path, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        return Err(format!(
            "{} already exists. Rename the skill instead of overwriting it.",
            dest.display()
        ));
    }

    let (bytes, files) = measure_tree(source)?;
    if bytes > MAX_SKILL_TREE_BYTES {
        return Err(format!(
            "{} holds {bytes} bytes, over the {MAX_SKILL_TREE_BYTES}-byte limit for one skill.",
            source.display()
        ));
    }
    if files > MAX_SKILL_TREE_FILES {
        return Err(format!(
            "{} holds {files} files, over the {MAX_SKILL_TREE_FILES}-file limit for one skill.",
            source.display()
        ));
    }

    copy_dir_recursive(source, dest, 0)
}

fn measure_tree(dir: &Path) -> Result<(u64, usize), String> {
    let mut bytes = 0u64;
    let mut files = 0usize;
    let mut stack = vec![dir.to_path_buf()];
    let mut depth_guard = 0;
    while let Some(current) = stack.pop() {
        depth_guard += 1;
        if depth_guard > MAX_SKILL_TREE_FILES * 2 {
            return Err("the source directory is too deeply nested".to_string());
        }
        let entries =
            std::fs::read_dir(&current).map_err(|e| format!("read {}: {e}", current.display()))?;
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = std::fs::symlink_metadata(&path) else {
                continue;
            };
            if meta.file_type().is_symlink() {
                // A symlink inside an import source could point anywhere. The
                // copy is content-only; links are not followed and not copied.
                continue;
            }
            if meta.is_dir() {
                stack.push(path);
            } else if meta.is_file() {
                bytes += meta.len();
                files += 1;
            }
        }
    }
    Ok((bytes, files))
}

const MAX_COPY_DEPTH: usize = 8;

fn copy_dir_recursive(source: &Path, dest: &Path, depth: usize) -> Result<(), String> {
    if depth > MAX_COPY_DEPTH {
        return Err(format!(
            "{} nests deeper than {MAX_COPY_DEPTH} levels",
            source.display()
        ));
    }
    std::fs::create_dir_all(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
    let entries =
        std::fs::read_dir(source).map_err(|e| format!("read {}: {e}", source.display()))?;
    for entry in entries.flatten() {
        let from = entry.path();
        let Some(file_name) = from.file_name() else {
            continue;
        };
        let to = dest.join(file_name);
        let Ok(meta) = std::fs::symlink_metadata(&from) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            copy_dir_recursive(&from, &to, depth + 1)?;
        } else if meta.is_file() {
            std::fs::copy(&from, &to)
                .map_err(|e| format!("copy {} → {}: {e}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

/// Create the per-runtime symlinks for one skill (§4 step 2).
///
/// Idempotent, and non-fatal by design: a filesystem that cannot make symlinks
/// still gets a working skill through the canonical directory.
pub fn ensure_runtime_links(roots: &LibraryRoots, name: &str) -> (Vec<String>, Vec<String>) {
    let mut created = Vec::new();
    let mut warnings = Vec::new();

    for (link, target) in roots.runtime_links(name) {
        let Some(parent) = link.parent() else {
            continue;
        };
        if let Err(error) = std::fs::create_dir_all(parent) {
            warnings.push(format!("create {}: {error}", parent.display()));
            continue;
        }
        if link.symlink_metadata().is_ok() {
            // Already there — a real dir, a good link, or a dangling one. Same
            // rule as `ensure_skill_symlinks`: leave it alone.
            created.push(link.to_string_lossy().to_string());
            continue;
        }
        match symlink_dir(Path::new(&target), &link) {
            Ok(()) => created.push(link.to_string_lossy().to_string()),
            Err(error) => warnings.push(format!("symlink {} → {target}: {error}", link.display())),
        }
    }

    (created, warnings)
}

#[cfg(unix)]
fn symlink_dir(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(not(unix))]
fn symlink_dir(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(target, link)
}

// ── git ──────────────────────────────────────────────────────────────────────

/// Who and why, for the commit trailer (§5.2).
#[derive(Debug, Clone)]
pub struct CommitContext {
    /// `importa` | `crea` | `edita`
    pub verb: &'static str,
    pub skill: String,
    pub reason: String,
    /// `Library`, or an agent's name.
    pub agent: String,
    /// Source path, `formulario`, or `edición`.
    pub origin: String,
}

impl CommitContext {
    pub fn message(&self) -> String {
        format!(
            "{} {}: {}\n\nAgente: {}\nOrigen: {}\n",
            self.verb, self.skill, self.reason, self.agent, self.origin
        )
    }
}

fn run_git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map_err(|e| format!("git {}: {e}", args.join(" ")))?;
    if !output.status.success() {
        return Err(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// True when the skills directory is a git repository.
pub fn is_repo(skills_dir: &Path) -> bool {
    run_git(skills_dir, &["rev-parse", "--git-dir"]).is_ok()
}

/// Initialize the skills repository if it is not one yet, with the `.gitignore`
/// the contract specifies (§5.3) and the `estado actual` commit.
///
/// Idempotent: on an existing repo it does nothing.
pub fn ensure_repo(skills_dir: &Path) -> Result<(), String> {
    if is_repo(skills_dir) {
        return Ok(());
    }
    std::fs::create_dir_all(skills_dir)
        .map_err(|e| format!("create {}: {e}", skills_dir.display()))?;
    run_git(skills_dir, &["init", "-q"])?;
    let gitignore = skills_dir.join(".gitignore");
    if !gitignore.exists() {
        std::fs::write(&gitignore, DEFAULT_GITIGNORE)
            .map_err(|e| format!("write {}: {e}", gitignore.display()))?;
    }
    run_git(skills_dir, &["add", "-A"])?;
    // An empty directory has nothing to commit, and that is fine.
    if run_git(skills_dir, &["diff", "--cached", "--name-only"])?.is_empty() {
        return Ok(());
    }
    run_git(
        skills_dir,
        &[
            "commit",
            "-q",
            "-m",
            "estado actual\n\nCommit inicial del repositorio local de skills.\n\nAgente: Library\nOrigen: estado inicial del disco\n",
        ],
    )?;
    Ok(())
}

pub const DEFAULT_GITIGNORE: &str = "\
# Repositorio local de skills de los agentes de Buzz.
# Convencion de commits: docs/spec-agent-profile.md §5.

# Ruido del sistema
.DS_Store
Thumbs.db

# Artefactos de ejecucion
*.log
*.tmp
__pycache__/
node_modules/
.venv/
venv/

# Estado transitorio
.scratch/
";

/// Stage one skill directory and commit it on its own (§5.1).
///
/// Scoping `git add` to the skill's own path is what keeps the one-commit-per-
/// skill rule true when several skills are imported in one batch.
pub fn commit_skill(
    skills_dir: &Path,
    name: &str,
    context: &CommitContext,
) -> Result<String, String> {
    ensure_repo(skills_dir)?;
    run_git(skills_dir, &["add", "--", name])?;
    let staged = run_git(skills_dir, &["diff", "--cached", "--name-only"])?;
    if staged.is_empty() {
        return Err(format!("nothing staged for {name}"));
    }
    run_git(skills_dir, &["commit", "-q", "-m", &context.message()])?;
    run_git(skills_dir, &["rev-parse", "--short", "HEAD"])
}

/// Full write path: copy, link, commit. Used by import and create alike.
/// Make sure the skills directory is a repository **before** anything is
/// written into it.
///
/// Ordering is the whole point. `ensure_repo` bootstraps a new repo with
/// `git add -A` + the `estado actual` commit — a snapshot of what was already
/// on disk. Run after a copy, that snapshot swallows the skill just written:
/// it lands inside `estado actual` instead of getting its own commit (§5.1),
/// and the subsequent `git add -- <name>` then finds nothing new to stage and
/// reports "not committed" for a skill that is, confusingly, committed.
///
/// Non-fatal: a git failure never blocks a write (§4). The warning is
/// returned so the caller can surface it.
fn ensure_repo_before_write(skills_dir: &Path) -> Option<String> {
    match ensure_repo(skills_dir) {
        Ok(()) => None,
        Err(error) => Some(format!("git: {error}")),
    }
}

pub fn write_skill(
    roots: &LibraryRoots,
    name: &str,
    source: &Path,
    context: &CommitContext,
) -> Result<WriteOutcome, String> {
    validate_skill_name(name).map_err(|e| e.message())?;
    let skills_dir = roots.skills_dir();
    std::fs::create_dir_all(&skills_dir)
        .map_err(|e| format!("create {}: {e}", skills_dir.display()))?;

    // Step 0 — the repo must exist before the copy, so its baseline snapshot
    // cannot absorb the skill this call is about to write.
    let mut warnings = Vec::new();
    warnings.extend(ensure_repo_before_write(&skills_dir));

    // Step 1 — canonical copy. The only step whose failure aborts.
    let dest = resolve_new_within(&roots.skill_dir(name), std::slice::from_ref(&skills_dir))
        .map_err(|denied| denied.message(&roots.skill_dir(name)))?;
    copy_skill_tree(source, &dest)?;

    // Step 2 — runtime symlinks.
    let (links, link_warnings) = ensure_runtime_links(roots, name);
    warnings.extend(link_warnings);

    // Step 3 — one commit for this skill.
    let commit = match commit_skill(&skills_dir, name, context) {
        Ok(hash) => Some(hash),
        Err(error) => {
            warnings.push(format!("git: {error}"));
            None
        }
    };

    Ok(WriteOutcome {
        name: name.to_string(),
        dir: dest.to_string_lossy().to_string(),
        links,
        commit,
        warnings,
    })
}

/// Render a `SKILL.md` from the three fields the create form collects.
pub fn render_skill_md(name: &str, description: &str, body: &str) -> String {
    let mut out = String::from("---\nname: ");
    out.push_str(name);
    out.push_str("\ndescription: >\n");
    for line in wrap_description(description) {
        out.push_str("  ");
        out.push_str(&line);
        out.push('\n');
    }
    out.push_str("version: 1\n---\n\n");
    out.push_str(body.trim_start());
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// Soft-wrap the description for the folded YAML block. Purely cosmetic — the
/// folded scalar joins the lines back into one string on read.
fn wrap_description(description: &str) -> Vec<String> {
    const WIDTH: usize = 74;
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in description.split_whitespace() {
        if !current.is_empty() && current.chars().count() + 1 + word.chars().count() > WIDTH {
            lines.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }
    if !current.is_empty() {
        lines.push(current);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

/// Replace the description and body of an existing `SKILL.md`, keeping `name`
/// and every other frontmatter key untouched (§4.4).
pub fn rewrite_skill_md(existing: &str, description: &str, body: &str) -> String {
    let front = parse_skill_frontmatter(existing);
    let name = front.name.unwrap_or_default();
    let (_, _existing_body) = split_frontmatter(existing);
    render_skill_md(&name, description, body)
}

/// Edit an existing skill in place: rewrite `SKILL.md`, commit (§4.4).
pub fn edit_skill(
    roots: &LibraryRoots,
    name: &str,
    description: &str,
    body: &str,
    context: &CommitContext,
) -> Result<WriteOutcome, String> {
    validate_skill_name(name).map_err(|e| e.message())?;
    let skills_dir = roots.skills_dir();
    let skill_md = roots.skill_dir(name).join("SKILL.md");
    let resolved = resolve_within(&skill_md, std::slice::from_ref(&skills_dir))
        .map_err(|denied| denied.message(&skill_md))?;

    let existing = read_capped(&resolved)?;
    let next = rewrite_skill_md(&existing, description, body);
    std::fs::write(&resolved, next).map_err(|e| format!("write {}: {e}", resolved.display()))?;

    let mut warnings = Vec::new();
    let commit = match commit_skill(&skills_dir, name, context) {
        Ok(hash) => Some(hash),
        Err(error) => {
            warnings.push(format!("git: {error}"));
            None
        }
    };

    Ok(WriteOutcome {
        name: name.to_string(),
        dir: roots.skill_dir(name).to_string_lossy().to_string(),
        links: Vec::new(),
        commit,
        warnings,
    })
}

/// Write a brand-new skill from the create form (§4.2).
pub fn create_skill(
    roots: &LibraryRoots,
    name: &str,
    description: &str,
    body: &str,
    context: &CommitContext,
) -> Result<WriteOutcome, String> {
    validate_skill_name(name).map_err(|e| e.message())?;
    let dest = roots.skill_dir(name);
    if dest.exists() {
        return Err(format!(
            "A skill named `{name}` already exists. Pick another name — overwriting one silently removes it from every agent's prompt."
        ));
    }
    let skills_dir = roots.skills_dir();
    std::fs::create_dir_all(&skills_dir)
        .map_err(|e| format!("create {}: {e}", skills_dir.display()))?;

    // Same ordering rule as `write_skill`: baseline the repo first.
    let mut warnings = Vec::new();
    warnings.extend(ensure_repo_before_write(&skills_dir));

    std::fs::create_dir_all(&dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
    std::fs::write(
        dest.join("SKILL.md"),
        render_skill_md(name, description, body),
    )
    .map_err(|e| format!("write SKILL.md: {e}"))?;

    let (links, link_warnings) = ensure_runtime_links(roots, name);
    warnings.extend(link_warnings);

    let commit = match commit_skill(&skills_dir, name, context) {
        Ok(hash) => Some(hash),
        Err(error) => {
            warnings.push(format!("git: {error}"));
            None
        }
    };

    Ok(WriteOutcome {
        name: name.to_string(),
        dir: dest.to_string_lossy().to_string(),
        links,
        commit,
        warnings,
    })
}
