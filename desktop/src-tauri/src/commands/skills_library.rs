//! Tauri commands for the Skills library and the agent profile.
//!
//! Every command resolves its paths through `skills_library::paths` before
//! touching the filesystem. None of them accepts a free-form path to read or
//! write: the writable set is the nest's skill and eval directories, and the
//! readable set adds the standing import roots plus the one directory the user
//! picked in the system dialog. See `docs/spec-agent-profile.md` §7.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::skills_library::contract::{
    read_agent_evals, read_capped, split_frontmatter, AgentEvals,
};
use crate::skills_library::discovery::{
    library_inventory, runtime_skill_view, LibrarySkill, RuntimeSkillView,
};
use crate::skills_library::import::{plan_import, ImportPreview};
use crate::skills_library::names::{
    judge_description, slugify, validate_skill_name, DescriptionVerdict,
};
use crate::skills_library::paths::{resolve_import_source, resolve_within, LibraryRoots};
use crate::skills_library::writer::{
    create_skill as write_new_skill, edit_skill, ensure_repo, write_skill, CommitContext,
    WriteOutcome,
};

/// Resolve the library roots, honouring a test override.
///
/// `BUZZ_SKILLS_ROOT` exists so the Rust and e2e suites can point the whole
/// module at a temp directory. It is read from the environment of the app
/// process, which in production nobody sets.
fn roots() -> Result<LibraryRoots, String> {
    if let Ok(override_root) = std::env::var("BUZZ_SKILLS_ROOT") {
        let nest = PathBuf::from(&override_root);
        let home = std::env::var("BUZZ_SKILLS_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| nest.clone());
        return Ok(LibraryRoots::new(nest, home));
    }
    LibraryRoots::from_env()
}

// ── Reading ──────────────────────────────────────────────────────────────────

/// The global inventory the library lists (§6.2).
#[tauri::command]
pub async fn list_library_skills() -> Result<Vec<LibrarySkill>, String> {
    let roots = roots()?;
    Ok(library_inventory(&roots))
}

/// What one runtime would discover, in resolution order, with shadowing marked.
#[tauri::command]
pub async fn agent_runtime_skills(runtime_id: String) -> Result<RuntimeSkillView, String> {
    let roots = roots()?;
    Ok(runtime_skill_view(&runtime_id, &roots))
}

/// Read one `SKILL.md`, split into frontmatter and body.
///
/// `dir` is an absolute skill directory that must resolve inside a managed or
/// standing import root — the same skill directories the reading surfaces just
/// listed, and nothing else.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDocument {
    pub path: String,
    pub frontmatter: Option<String>,
    pub body: String,
}

#[tauri::command]
pub async fn read_skill_document(dir: String) -> Result<SkillDocument, String> {
    let roots = roots()?;
    let candidate = Path::new(&dir).join("SKILL.md");
    let resolved = resolve_within(&candidate, &roots.standing_import_roots())
        .map_err(|denied| denied.message(&candidate))?;
    let content = read_capped(&resolved)?;
    let (frontmatter, body) = split_frontmatter(&content);
    Ok(SkillDocument {
        path: resolved.to_string_lossy().to_string(),
        frontmatter: frontmatter.map(str::to_string),
        body: body.to_string(),
    })
}

/// Read one supporting file of a skill, for the profile's file list.
#[tauri::command]
pub async fn read_skill_supporting_file(dir: String, relative: String) -> Result<String, String> {
    let roots = roots()?;
    let candidate = Path::new(&dir).join(&relative);
    let resolved = resolve_within(&candidate, &roots.standing_import_roots())
        .map_err(|denied| denied.message(&candidate))?;
    read_capped(&resolved)
}

/// Read one agent's evals (§3). A missing directory is a normal empty result.
#[tauri::command]
pub async fn read_agent_eval_contract(
    agent_name: String,
    pubkey: Option<String>,
) -> Result<AgentEvals, String> {
    let roots = roots()?;
    let evals_root = roots.evals_dir();
    let slug = slugify(&agent_name);

    // Prefer the readable slug; fall back to the pubkey directory (§3.1).
    let by_slug = evals_root.join(&slug);
    if by_slug.is_dir() {
        let resolved = resolve_within(&by_slug, std::slice::from_ref(&evals_root))
            .map_err(|denied| denied.message(&by_slug))?;
        return Ok(read_agent_evals(&resolved));
    }
    if let Some(pubkey) =
        pubkey.filter(|p| p.len() == 64 && p.chars().all(|c| c.is_ascii_hexdigit()))
    {
        let by_pubkey = evals_root.join(&pubkey);
        if by_pubkey.is_dir() {
            let resolved = resolve_within(&by_pubkey, std::slice::from_ref(&evals_root))
                .map_err(|denied| denied.message(&by_pubkey))?;
            return Ok(read_agent_evals(&resolved));
        }
    }
    // Nothing on disk: report the directory that would hold it.
    Ok(read_agent_evals(&by_slug))
}

// ── Import ───────────────────────────────────────────────────────────────────

/// Preview an import. Reads only.
///
/// `source` is the directory the user picked in the system dialog; that pick is
/// what authorizes reading it, and only for this operation.
#[tauri::command]
pub async fn preview_skill_import(source: String) -> Result<ImportPreview, String> {
    let roots = roots()?;
    let picked = PathBuf::from(&source);
    let resolved = resolve_import_source(&picked, &roots, Some(&picked))
        .map_err(|denied| denied.message(&picked))?;
    Ok(plan_import(&resolved, &roots))
}

/// One skill the user confirmed, with any edits made in the preview.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmedImport {
    /// Absolute source directory, from the preview.
    pub source: String,
    /// Final name — the original, or the rename the user typed.
    pub name: String,
    /// Final activation description, possibly edited in the preview.
    pub description: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub outcomes: Vec<WriteOutcome>,
    /// Per-skill failures, as `name: reason`. A failure here does not stop the
    /// rest of the batch — each skill is independent, and so is its commit.
    pub failures: Vec<String>,
}

#[tauri::command]
pub async fn confirm_skill_import(
    source: String,
    items: Vec<ConfirmedImport>,
) -> Result<ImportResult, String> {
    let roots = roots()?;
    let picked = PathBuf::from(&source);
    resolve_import_source(&picked, &roots, Some(&picked))
        .map_err(|denied| denied.message(&picked))?;

    let mut outcomes = Vec::new();
    let mut failures = Vec::new();

    for item in items {
        let item_source = PathBuf::from(&item.source);
        let resolved_source = match resolve_import_source(&item_source, &roots, Some(&picked)) {
            Ok(path) => path,
            Err(denied) => {
                failures.push(format!("{}: {}", item.name, denied.message(&item_source)));
                continue;
            }
        };

        if let Err(error) = validate_skill_name(&item.name) {
            failures.push(format!("{}: {}", item.name, error.message()));
            continue;
        }
        if judge_description(&item.description) == DescriptionVerdict::Missing {
            failures.push(format!(
                "{}: a skill with no description never reaches the model's decision. Add one.",
                item.name
            ));
            continue;
        }

        let context = CommitContext {
            verb: "importa",
            skill: item.name.clone(),
            reason: format!("importada de {}", display_origin(&resolved_source)),
            agent: "Library".to_string(),
            origin: resolved_source.to_string_lossy().to_string(),
        };

        match write_skill(&roots, &item.name, &resolved_source, &context) {
            Ok(outcome) => {
                // Apply the preview's edits: the name may have been changed and
                // the description rewritten, and both live in the frontmatter.
                if let Err(error) = apply_import_edits(&roots, &item.name, &item.description) {
                    failures.push(format!("{}: {error}", item.name));
                }
                outcomes.push(outcome);
            }
            Err(error) => failures.push(format!("{}: {error}", item.name)),
        }
    }

    Ok(ImportResult { outcomes, failures })
}

/// After copying, normalize the imported `SKILL.md` so its `name` matches the
/// destination directory and its description is the one the user approved.
///
/// Amends the skill's own commit rather than adding a second one, keeping the
/// one-commit-per-skill rule (§5.1) true for an import that involved a rename.
fn apply_import_edits(roots: &LibraryRoots, name: &str, description: &str) -> Result<(), String> {
    let skills_dir = roots.skills_dir();
    let skill_md = roots.skill_dir(name).join("SKILL.md");
    let resolved = resolve_within(&skill_md, std::slice::from_ref(&skills_dir))
        .map_err(|d| d.message(&skill_md))?;
    let existing = read_capped(&resolved)?;
    let (_, body) = split_frontmatter(&existing);
    let next = crate::skills_library::writer::render_skill_md(name, description, body);
    if next == existing {
        return Ok(());
    }
    std::fs::write(&resolved, next).map_err(|e| format!("write {}: {e}", resolved.display()))?;

    ensure_repo(&skills_dir)?;
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(&skills_dir)
        .args(["add", "--", name])
        .output()
        .map_err(|e| format!("git add: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(&skills_dir)
        .args(["commit", "-q", "--amend", "--no-edit"])
        .output()
        .map_err(|e| format!("git commit --amend: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

/// Shorten an absolute source path for the commit subject.
fn display_origin(path: &Path) -> String {
    let text = path.to_string_lossy().to_string();
    match dirs::home_dir().and_then(|home| {
        path.strip_prefix(&home)
            .ok()
            .map(|rest| format!("~/{}", rest.display()))
    }) {
        Some(shortened) => shortened,
        None => text,
    }
}

// ── Create and edit ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_library_skill(
    name: String,
    description: String,
    body: String,
) -> Result<WriteOutcome, String> {
    let roots = roots()?;
    if judge_description(&description) == DescriptionVerdict::Missing {
        return Err(
            "The activation description is required: it is the only thing the model reads when deciding whether to use a skill.".to_string(),
        );
    }
    let context = CommitContext {
        verb: "crea",
        skill: name.clone(),
        reason: "creada desde la Library".to_string(),
        agent: "Library".to_string(),
        origin: "formulario".to_string(),
    };
    write_new_skill(&roots, &name, &description, &body, &context)
}

#[tauri::command]
pub async fn update_library_skill(
    name: String,
    description: String,
    body: String,
) -> Result<WriteOutcome, String> {
    let roots = roots()?;
    if judge_description(&description) == DescriptionVerdict::Missing {
        return Err(
            "The activation description is required: it is the only thing the model reads when deciding whether to use a skill.".to_string(),
        );
    }
    let context = CommitContext {
        verb: "edita",
        skill: name.clone(),
        reason: "actualizada desde la Library".to_string(),
        agent: "Library".to_string(),
        origin: "edición".to_string(),
    };
    edit_skill(&roots, &name, &description, &body, &context)
}

/// Recent commits of the skills repository, for the library's history view and
/// for tests that verify a write was committed.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCommit {
    pub hash: String,
    pub subject: String,
}

#[tauri::command]
pub async fn list_skill_commits(limit: Option<u32>) -> Result<Vec<SkillCommit>, String> {
    let roots = roots()?;
    let skills_dir = roots.skills_dir();
    if !skills_dir.is_dir() {
        return Ok(Vec::new());
    }
    let limit = limit.unwrap_or(50).clamp(1, 200);
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(&skills_dir)
        .args(["log", &format!("-{limit}"), "--format=%h%x1f%s"])
        .output()
        .map_err(|e| format!("git log: {e}"))?;
    if !output.status.success() {
        // Not a repository yet is not an error — it is an empty history.
        return Ok(Vec::new());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let (hash, subject) = line.split_once('\u{1f}')?;
            Some(SkillCommit {
                hash: hash.to_string(),
                subject: subject.to_string(),
            })
        })
        .collect())
}

/// Open the native folder picker for an import source.
///
/// The pick happens in Rust so the path the user chose is the same value the
/// import guard later treats as authorized — a picker in the webview would let
/// the frontend name any directory it liked and call it a user choice.
///
/// Returns `None` when the user cancels.
#[tauri::command]
pub async fn pick_skill_import_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });

    let picked = rx.await.map_err(|_| "dialog cancelled".to_string())?;
    let Some(folder) = picked else {
        return Ok(None);
    };
    let path = folder
        .as_path()
        .ok_or_else(|| "the folder dialog returned an invalid path".to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}
