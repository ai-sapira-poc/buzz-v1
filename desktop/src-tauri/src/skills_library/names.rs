//! Skill-name validation and the "is this description usable?" heuristic.
//!
//! See `docs/spec-agent-profile.md` §2.1 and §2.3. Both rules exist for the
//! same reason: a skill's `name` and `description` are the only two fields the
//! runtime reads from the frontmatter, and both fail silently when wrong.

/// Longest name we accept. Nothing in the runtime enforces a limit; this is a
/// legibility bound on a directory name that also appears in every agent's
/// system prompt.
const MAX_NAME_LEN: usize = 64;

/// Below this, a description is too short to state what a skill does *and*
/// when not to use it. Tuned to be conservative — it flags rather than blocks.
const MIN_DESCRIPTION_LEN: usize = 40;

/// Substrings that suggest the description names a trigger. Bilingual because
/// skills in this project are written in both languages.
const TRIGGER_MARKERS: &[&str] = &[
    "usar cuando",
    "use when",
    "usar para",
    "cuando ",
    "when ",
    "trigger",
    "úsala",
    "usala",
];

#[derive(Debug, PartialEq, Eq)]
pub enum NameError {
    Empty,
    TooLong,
    NotKebabCase,
}

impl NameError {
    pub fn message(&self) -> String {
        match self {
            Self::Empty => "The name is required.".to_string(),
            Self::TooLong => format!("The name must be at most {MAX_NAME_LEN} characters."),
            Self::NotKebabCase => {
                "Use kebab-case: lowercase letters, digits and single hyphens (e.g. resumir-hilos)."
                    .to_string()
            }
        }
    }
}

/// `^[a-z0-9]+(-[a-z0-9]+)*$`, 1–64 characters, hand-rolled to avoid pulling
/// in a regex engine for one pattern.
pub fn validate_skill_name(name: &str) -> Result<(), NameError> {
    if name.is_empty() {
        return Err(NameError::Empty);
    }
    if name.len() > MAX_NAME_LEN {
        return Err(NameError::TooLong);
    }

    let mut previous_was_hyphen = true; // a leading hyphen is invalid
    for ch in name.chars() {
        match ch {
            'a'..='z' | '0'..='9' => previous_was_hyphen = false,
            '-' if !previous_was_hyphen => previous_was_hyphen = true,
            _ => return Err(NameError::NotKebabCase),
        }
    }
    // a trailing hyphen is invalid too
    if previous_was_hyphen {
        return Err(NameError::NotKebabCase);
    }
    Ok(())
}

/// Best-effort kebab-case slug. Used for agent eval directories (§3.1) and to
/// pre-fill the rename field when an imported skill has an unusable name.
pub fn slugify(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut pending_hyphen = false;
    for ch in input.chars().flat_map(|c| c.to_lowercase()) {
        if ch.is_ascii_alphanumeric() {
            if pending_hyphen && !out.is_empty() {
                out.push('-');
            }
            pending_hyphen = false;
            out.push(ch);
        } else {
            // Fold accented Latin letters rather than dropping them, so
            // "Ana — Diseño" becomes ana-diseno and not ana-dise-o.
            match fold_latin(ch) {
                Some(folded) => {
                    if pending_hyphen && !out.is_empty() {
                        out.push('-');
                    }
                    pending_hyphen = false;
                    out.push(folded);
                }
                None => pending_hyphen = true,
            }
        }
    }
    out
}

fn fold_latin(ch: char) -> Option<char> {
    Some(match ch {
        'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' => 'a',
        'é' | 'è' | 'ë' | 'ê' => 'e',
        'í' | 'ì' | 'ï' | 'î' => 'i',
        'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
        'ú' | 'ù' | 'ü' | 'û' => 'u',
        'ñ' => 'n',
        'ç' => 'c',
        _ => return None,
    })
}

/// Verdict on a skill's activation description.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DescriptionVerdict {
    /// States what it does and when — good enough to ship.
    Usable,
    /// Present but too thin to steer activation; flagged, not blocked.
    Generic,
    /// Absent. The skill is invisible to the model's decision (L4).
    Missing,
}

/// See `docs/spec-agent-profile.md` §2.3. Deliberately conservative: it flags
/// more than it should, and the user either fixes it in place or accepts it.
pub fn judge_description(description: &str) -> DescriptionVerdict {
    let trimmed = description.trim();
    if trimmed.is_empty() {
        return DescriptionVerdict::Missing;
    }
    if trimmed.chars().count() < MIN_DESCRIPTION_LEN {
        return DescriptionVerdict::Generic;
    }
    let lowered = trimmed.to_lowercase();
    if TRIGGER_MARKERS.iter().any(|m| lowered.contains(m)) {
        return DescriptionVerdict::Usable;
    }
    DescriptionVerdict::Generic
}

/// Human-readable reason for a non-`Usable` verdict, shown next to the field.
pub fn description_hint(verdict: DescriptionVerdict) -> Option<&'static str> {
    match verdict {
        DescriptionVerdict::Usable => None,
        DescriptionVerdict::Generic => Some(
            "This description does not say when to use the skill. Every agent on this machine sees it, so a vague one hijacks turns that belong elsewhere. Say what it does, when to use it, and when not to.",
        ),
        DescriptionVerdict::Missing => Some(
            "Without a description the model never sees this skill — it only reads the description when deciding. Add what it does, when to use it, and when not to.",
        ),
    }
}
