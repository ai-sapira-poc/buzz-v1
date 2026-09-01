//! Parsers for the on-disk contract of `docs/spec-agent-profile.md`.
//!
//! One rule shapes all of this: the runtime fails **silently**. `hints.rs:105`
//! drops a skill with no `name`; `hints.rs:130` skips an unreadable `SKILL.md`.
//! These parsers do the opposite — they return the broken record with the
//! reason attached, so the reading surfaces can show the user why their skill
//! "doesn't exist".

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::names::{judge_description, DescriptionVerdict};
use super::paths::resolve_within;

/// Largest file this module will read. `SKILL.md` bodies are capped at 32 KiB
/// by the runtime itself (`hints::MAX_SKILL_BODY_BYTES`); this bound is on the
/// whole file and applies to eval documents too.
pub const MAX_CONTRACT_FILE_BYTES: u64 = 256 * 1024;

// ── SKILL.md ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFrontmatter {
    /// `None` when absent or empty — exactly the case the runtime drops.
    pub name: Option<String>,
    pub description: String,
    pub version: Option<String>,
}

/// Split a document into its YAML frontmatter block and its body.
///
/// Byte-for-byte the same framing as `hints::parse_skill_frontmatter`: the file
/// must start with `---\n` and the block ends at the first `\n---`. A file that
/// does not match is all body and no frontmatter — which is how the runtime
/// treats it too.
pub fn split_frontmatter(content: &str) -> (Option<&str>, &str) {
    let Some(rest) = content.strip_prefix("---\n") else {
        return (None, content);
    };
    let Some(close) = rest.find("\n---") else {
        return (None, content);
    };
    let yaml = &rest[..close];
    let after = &rest[close + 4..];
    let body = after.strip_prefix('\n').unwrap_or(after);
    (Some(yaml), body)
}

/// Read one scalar field out of a YAML frontmatter block.
fn yaml_field(map: &HashMap<String, serde_yaml::Value>, key: &str) -> Option<String> {
    let value = map.get(key)?;
    let text = match value {
        serde_yaml::Value::String(s) => s.clone(),
        serde_yaml::Value::Number(n) => n.to_string(),
        serde_yaml::Value::Bool(b) => b.to_string(),
        _ => return None,
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn parse_skill_frontmatter(content: &str) -> SkillFrontmatter {
    let (yaml, _) = split_frontmatter(content);
    let Some(yaml) = yaml else {
        return SkillFrontmatter {
            name: None,
            description: String::new(),
            version: None,
        };
    };
    let map: HashMap<String, serde_yaml::Value> = serde_yaml::from_str(yaml).unwrap_or_default();
    SkillFrontmatter {
        name: yaml_field(&map, "name"),
        description: yaml_field(&map, "description").unwrap_or_default(),
        version: yaml_field(&map, "version"),
    }
}

/// A problem that makes a skill invisible or unfindable. Reported, never hidden.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillProblem {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedSkill {
    /// Frontmatter `name`, or the directory name when the frontmatter has none.
    /// The directory name is a display fallback only — the runtime would have
    /// dropped this skill.
    pub name: String,
    /// Directory name on disk. Diverging from `name` is a reported problem.
    pub dir_name: String,
    pub description: String,
    pub description_verdict: DescriptionVerdict,
    pub version: Option<String>,
    /// Absolute path of the `SKILL.md`.
    pub path: String,
    /// Absolute path of the skill directory.
    pub dir: String,
    /// Relative paths of every non-`SKILL.md` file in the tree, sorted.
    pub supporting_files: Vec<String>,
    /// Empty when the skill is well-formed.
    pub problems: Vec<SkillProblem>,
    /// False when the runtime would discard this skill outright.
    pub discoverable: bool,
}

/// Parse one skill directory. `dir` must already have passed the path guard.
pub fn parse_skill_dir(dir: &Path) -> Result<ParsedSkill, String> {
    let dir_name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("{} has no directory name", dir.display()))?
        .to_string();
    let skill_md = dir.join("SKILL.md");

    let mut problems = Vec::new();
    let content = match read_capped(&skill_md) {
        Ok(text) => text,
        Err(error) => {
            return Err(format!("{}: {error}", skill_md.display()));
        }
    };

    let front = parse_skill_frontmatter(&content);
    let discoverable = front.name.is_some();
    if front.name.is_none() {
        problems.push(SkillProblem {
            code: "missingName",
            message:
                "The frontmatter has no `name`, so the runtime discards this skill without a word."
                    .to_string(),
        });
    }
    let name = front.name.clone().unwrap_or_else(|| dir_name.clone());
    if front.name.is_some() && name != dir_name {
        problems.push(SkillProblem {
            code: "nameDirMismatch",
            message: format!(
                "The frontmatter name is `{name}` but the directory is `{dir_name}`. The runtime uses the frontmatter, so this skill is hard to find on disk."
            ),
        });
    }

    let verdict = judge_description(&front.description);
    match verdict {
        DescriptionVerdict::Missing => problems.push(SkillProblem {
            code: "missingDescription",
            message: "No description: the model only reads the description when deciding whether to use a skill.".to_string(),
        }),
        DescriptionVerdict::Generic => problems.push(SkillProblem {
            code: "genericDescription",
            message: "The description does not name a trigger, so it can hijack turns meant for other agents.".to_string(),
        }),
        DescriptionVerdict::Usable => {}
    }

    Ok(ParsedSkill {
        name,
        dir_name,
        description: front.description,
        description_verdict: verdict,
        version: front.version,
        path: skill_md.to_string_lossy().to_string(),
        dir: dir.to_string_lossy().to_string(),
        supporting_files: collect_supporting_files(dir),
        problems,
        discoverable,
    })
}

/// Every non-`SKILL.md` file under `dir`, as paths relative to `dir`, sorted.
///
/// Does not descend into a subdirectory that has its own `SKILL.md` — that is
/// a separate skill, not a supporting file. Same rule as
/// `hints::collect_supporting_files`.
pub fn collect_supporting_files(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    collect_supporting_files_impl(dir, dir, &mut out, 0);
    out.sort();
    out
}

/// Depth bound so a symlink cycle inside a skill directory cannot spin forever.
const MAX_SUPPORTING_DEPTH: usize = 8;

fn collect_supporting_files_impl(root: &Path, dir: &Path, out: &mut Vec<String>, depth: usize) {
    if depth > MAX_SUPPORTING_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            if path.join("SKILL.md").exists() {
                continue;
            }
            collect_supporting_files_impl(root, &path, out, depth + 1);
        } else if ft.is_file() && path.file_name().and_then(|n| n.to_str()) != Some("SKILL.md") {
            if let Ok(rel) = path.strip_prefix(root) {
                out.push(rel.to_string_lossy().to_string());
            }
        }
    }
}

/// Read a UTF-8 file, refusing anything over [`MAX_CONTRACT_FILE_BYTES`].
pub fn read_capped(path: &Path) -> Result<String, String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("not a file".to_string());
    }
    if metadata.len() > MAX_CONTRACT_FILE_BYTES {
        return Err(format!(
            "file is {} bytes, over the {MAX_CONTRACT_FILE_BYTES}-byte limit",
            metadata.len()
        ));
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

// ── Evals ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalCase {
    pub number: u32,
    pub title: String,
    /// `nacimiento` | `feedback`, verbatim from the contract.
    pub origin: String,
    pub date: String,
    pub author: String,
    pub input: String,
    pub expected: String,
    pub file_name: String,
    pub problems: Vec<SkillProblem>,
}

const INPUT_HEADING: &str = "## Input";
const EXPECTED_HEADING: &str = "## Output esperado";

/// Pull the text under an exact `##` heading, up to the next `##`.
fn section_after(body: &str, heading: &str) -> Option<String> {
    let mut collecting = false;
    let mut out = String::new();
    for line in body.lines() {
        if line.trim_end() == heading {
            collecting = true;
            continue;
        }
        if collecting && line.starts_with("## ") {
            break;
        }
        if collecting {
            out.push_str(line);
            out.push('\n');
        }
    }
    if collecting {
        Some(out.trim().to_string())
    } else {
        None
    }
}

pub fn parse_eval_case(file_name: &str, content: &str) -> EvalCase {
    let (yaml, body) = split_frontmatter(content);
    let map: HashMap<String, serde_yaml::Value> = yaml
        .and_then(|y| serde_yaml::from_str(y).ok())
        .unwrap_or_default();

    let mut problems = Vec::new();

    let number_from_name = file_name
        .strip_prefix("caso-")
        .and_then(|rest| rest.strip_suffix(".md"))
        .and_then(|digits| digits.parse::<u32>().ok());
    let number_from_front = yaml_field(&map, "caso").and_then(|v| v.parse::<u32>().ok());
    if let (Some(from_name), Some(from_front)) = (number_from_name, number_from_front) {
        if from_name != from_front {
            problems.push(SkillProblem {
                code: "caseNumberMismatch",
                message: format!(
                    "The frontmatter says caso {from_front} but the file is named caso-{from_name:02}.md."
                ),
            });
        }
    }
    let number = number_from_front.or(number_from_name).unwrap_or(0);

    let title = yaml_field(&map, "titulo").unwrap_or_else(|| {
        problems.push(SkillProblem {
            code: "missingTitle",
            message: "The case has no `titulo`.".to_string(),
        });
        format!("caso-{number:02}")
    });

    let origin = yaml_field(&map, "origen").unwrap_or_default();
    if origin != "nacimiento" && origin != "feedback" {
        problems.push(SkillProblem {
            code: "badOrigin",
            message: format!(
                "`origen` must be `nacimiento` or `feedback`, found `{}`.",
                if origin.is_empty() {
                    "(empty)"
                } else {
                    &origin
                }
            ),
        });
    }

    let date = yaml_field(&map, "fecha").unwrap_or_default();
    if date.is_empty() {
        problems.push(SkillProblem {
            code: "missingDate",
            message: "The case has no `fecha`.".to_string(),
        });
    }
    let author = yaml_field(&map, "autor").unwrap_or_default();
    if author.is_empty() {
        problems.push(SkillProblem {
            code: "missingAuthor",
            message: "The case has no `autor`.".to_string(),
        });
    }

    let input = section_after(body, INPUT_HEADING).unwrap_or_else(|| {
        problems.push(SkillProblem {
            code: "missingInput",
            message: format!("The case has no `{INPUT_HEADING}` section."),
        });
        String::new()
    });
    let expected = section_after(body, EXPECTED_HEADING).unwrap_or_else(|| {
        problems.push(SkillProblem {
            code: "missingExpected",
            message: format!("The case has no `{EXPECTED_HEADING}` section."),
        });
        String::new()
    });

    EvalCase {
        number,
        title,
        origin,
        date,
        author,
        input,
        expected,
        file_name: file_name.to_string(),
        problems,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackEntry {
    pub date: String,
    pub author: String,
    /// `abierto` | `corregido` | `descartado`
    pub status: String,
    pub body: String,
    /// `caso-NN` referenced by a `→ ` line, when present.
    pub linked_case: Option<String>,
}

/// Parse `feedback-log.md` (§3.3). Entries come back in file order, which the
/// contract fixes as newest first.
pub fn parse_feedback_log(content: &str) -> Vec<FeedbackEntry> {
    let mut entries: Vec<FeedbackEntry> = Vec::new();
    let mut current: Option<FeedbackEntry> = None;

    for line in content.lines() {
        if let Some(header) = line.strip_prefix("## ") {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            let parts: Vec<&str> = header.split('·').map(str::trim).collect();
            current = Some(FeedbackEntry {
                date: parts.first().copied().unwrap_or_default().to_string(),
                author: parts.get(1).copied().unwrap_or_default().to_string(),
                status: parts.get(2).copied().unwrap_or_default().to_string(),
                body: String::new(),
                linked_case: None,
            });
            continue;
        }
        let Some(entry) = current.as_mut() else {
            continue; // preamble (the `# Feedback log` heading)
        };
        if let Some(link) = line.trim().strip_prefix("→ ") {
            entry.linked_case = Some(link.trim().to_string());
            continue;
        }
        entry.body.push_str(line);
        entry.body.push('\n');
    }
    if let Some(entry) = current.take() {
        entries.push(entry);
    }

    for entry in &mut entries {
        entry.body = entry.body.trim().to_string();
    }
    entries
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulletinRow {
    pub case: String,
    pub score: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bulletin {
    pub date: String,
    pub runner: String,
    pub score: String,
    /// `sube` | `baja` | `estable` | `primera`
    pub trend: String,
    pub rows: Vec<BulletinRow>,
    pub problems: Vec<SkillProblem>,
}

/// Parse `boletin-ultimo.md` (§3.4).
pub fn parse_bulletin(content: &str) -> Bulletin {
    let (yaml, body) = split_frontmatter(content);
    let map: HashMap<String, serde_yaml::Value> = yaml
        .and_then(|y| serde_yaml::from_str(y).ok())
        .unwrap_or_default();
    let mut problems = Vec::new();

    let trend = yaml_field(&map, "tendencia").unwrap_or_default();
    if !matches!(trend.as_str(), "sube" | "baja" | "estable" | "primera") {
        problems.push(SkillProblem {
            code: "badTrend",
            message: format!(
                "`tendencia` must be sube, baja, estable or primera; found `{}`.",
                if trend.is_empty() { "(empty)" } else { &trend }
            ),
        });
    }

    // R7 — `puntuacion` out of 0.00–1.00 is an invalid bulletin (§3.4). Kept as
    // its own branch, deliberately separate from the `tendencia` check above and
    // from the field read below: an ABSENT `puntuacion` is a legitimate bulletin
    // that simply has no score (R7b), not an invalid one. Folding the range test
    // into the read would make "absent" and "out of range" the same code path,
    // which is exactly how R7b turns into R7.
    let raw_score = yaml_field(&map, "puntuacion").unwrap_or_default();
    if !raw_score.trim().is_empty() {
        let in_range = raw_score
            .trim()
            .parse::<f64>()
            .map(|n| (0.0..=1.0).contains(&n))
            .unwrap_or(false);
        if !in_range {
            problems.push(SkillProblem {
                code: "badScore",
                message: format!(
                    "`puntuacion` must be a decimal between 0.00 and 1.00; found `{}`.",
                    raw_score.trim()
                ),
            });
        }
    }

    let mut rows = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('|') {
            continue;
        }
        let cells: Vec<String> = trimmed
            .trim_matches('|')
            .split('|')
            .map(|c| c.trim().to_string())
            .collect();
        if cells.len() < 3 {
            continue;
        }
        // Skip the header row and the `|---|` separator.
        if cells[0].eq_ignore_ascii_case("caso") || cells[0].starts_with("---") {
            continue;
        }
        rows.push(BulletinRow {
            case: cells[0].clone(),
            score: cells[1].clone(),
            note: cells[2].clone(),
        });
    }

    Bulletin {
        date: yaml_field(&map, "fecha").unwrap_or_default(),
        runner: yaml_field(&map, "runner").unwrap_or_default(),
        score: yaml_field(&map, "puntuacion").unwrap_or_default(),
        trend,
        rows,
        problems,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvals {
    /// Directory the evals were read from, or the one that was looked for.
    pub dir: String,
    pub exists: bool,
    pub cases: Vec<EvalCase>,
    pub feedback: Vec<FeedbackEntry>,
    pub bulletin: Option<Bulletin>,
    /// Cases scored in the bulletin with no `caso-NN.md`, and vice versa (§3.4).
    pub discrepancies: Vec<String>,
}

/// One agent's evals, with the directory name they were listed under.
///
/// `read_agent_eval_contract` reads one agent given its name or pubkey;
/// nothing before this walked every folder under `evals_dir()` at once (§3.1
/// — "la carpeta manda"). This is that listing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvalSummary {
    /// The folder name as it sits on disk under `evals_dir()` — an agent's
    /// slug, or its pubkey when that is the only directory that exists (§3.1).
    pub dir_name: String,
    #[serde(flatten)]
    pub evals: AgentEvals,
}

/// The whole evals listing: the root that was read, plus one entry per agent.
///
/// R3 — the root travels with the response even when the listing is empty. A
/// missing root and a root with no agents both come back as zero agents
/// (`list_agent_evals`), so the list alone cannot tell "nobody has written
/// evals yet" apart from "this build is looking at the wrong directory". The
/// path is the only thing that distinguishes them, and it lives nowhere else:
/// `AgentEvals.dir` is per agent, so an empty listing carries no `dir` at all.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvalListing {
    /// The directory that was read, whether or not it exists.
    pub root: String,
    pub agents: Vec<AgentEvalSummary>,
}

/// Read `evals_root` into an [`AgentEvalListing`].
///
/// Wraps [`list_agent_evals`] rather than replacing it: the containment and
/// read-only guarantees (§7, R8) live there and are covered by its own tests,
/// and this adds only the root path to the response.
pub fn list_agent_eval_listing(evals_root: &Path) -> AgentEvalListing {
    AgentEvalListing {
        root: evals_root.to_string_lossy().to_string(),
        agents: list_agent_evals(evals_root),
    }
}

/// List every immediate subdirectory of `evals_root` and read its evals.
///
/// A root that does not exist yet is an empty list, not an error — the same
/// "nobody has written evals for this agent yet" case [`read_agent_evals`]
/// already treats as normal, just for the whole directory instead of one
/// agent. Sorted by directory name for a stable listing.
///
/// A subdirectory that is a symlink resolving outside `evals_root` is
/// excluded rather than read: the same containment rule every other reader in
/// this module applies through [`resolve_within`] (`paths.rs` §7), applied
/// here to the one place that walks `evals_root` itself instead of being
/// handed one already-resolved agent directory.
pub fn list_agent_evals(evals_root: &Path) -> Vec<AgentEvalSummary> {
    let Ok(entries) = std::fs::read_dir(evals_root) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| {
            std::fs::metadata(e.path())
                .map(|m| m.is_dir())
                .unwrap_or(false)
        })
        .map(|e| e.path())
        .collect();
    dirs.sort();

    let root_as_slice = [evals_root.to_path_buf()];
    dirs.iter()
        .filter_map(|dir| {
            let dir_name = dir.file_name()?.to_str()?.to_string();
            let resolved = resolve_within(dir, &root_as_slice).ok()?;
            Some(AgentEvalSummary {
                dir_name,
                evals: read_agent_evals(&resolved),
            })
        })
        .collect()
}

/// Read one agent's eval directory. Missing directory is not an error — it is
/// the normal state for an agent nobody has written evals for yet.
pub fn read_agent_evals(dir: &Path) -> AgentEvals {
    let dir_display = dir.to_string_lossy().to_string();
    if !dir.is_dir() {
        return AgentEvals {
            dir: dir_display,
            exists: false,
            cases: Vec::new(),
            feedback: Vec::new(),
            bulletin: None,
            discrepancies: Vec::new(),
        };
    }

    let mut cases = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        let mut files: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("caso-") && n.ends_with(".md"))
            })
            .collect();
        files.sort();
        for file in files {
            let Some(file_name) = file.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let Ok(content) = read_capped(&file) else {
                continue;
            };
            cases.push(parse_eval_case(file_name, &content));
        }
    }
    cases.sort_by_key(|c| c.number);

    let feedback = read_capped(&dir.join("feedback-log.md"))
        .map(|content| parse_feedback_log(&content))
        .unwrap_or_default();
    let bulletin = read_capped(&dir.join("boletin-ultimo.md"))
        .ok()
        .map(|content| parse_bulletin(&content));

    let mut discrepancies = Vec::new();
    if let Some(bulletin) = &bulletin {
        let case_ids: Vec<String> = cases
            .iter()
            .map(|c| format!("caso-{:02}", c.number))
            .collect();
        for row in &bulletin.rows {
            if !case_ids.iter().any(|id| id == &row.case) {
                discrepancies.push(format!(
                    "The bulletin scores {} but there is no {}.md on disk.",
                    row.case, row.case
                ));
            }
        }
        for id in &case_ids {
            if !bulletin.rows.iter().any(|row| &row.case == id) {
                discrepancies.push(format!("{id} is not scored in the latest bulletin."));
            }
        }
    }

    AgentEvals {
        dir: dir_display,
        exists: true,
        cases,
        feedback,
        bulletin,
        discrepancies,
    }
}
