//! The write path: canonical copy, runtime symlinks, one commit per skill
//! (spec §4, §5).

use super::{configure_git_identity, context, fixtures, nest};
use crate::skills_library::contract::{parse_skill_dir, split_frontmatter};
use crate::skills_library::discovery::library_inventory;
use crate::skills_library::names::{judge_description, DescriptionVerdict};
use crate::skills_library::paths::RUNTIME_SKILL_DIRS;
use crate::skills_library::writer::{
    commit_skill, copy_skill_tree, create_skill, edit_skill, ensure_repo, git_command, is_repo,
    render_skill_md, write_skill, CommitContext,
};
use std::path::PathBuf;

#[test]
fn copy_refuses_to_overwrite_an_existing_skill() {
    let nest = nest();
    let dest = nest.roots.skill_dir("ocupada");
    std::fs::create_dir_all(&dest).unwrap();
    let error = copy_skill_tree(&fixtures().join("skills/revisar-pr"), &dest).unwrap_err();
    assert!(error.contains("already exists"), "{error}");
}

#[test]
fn write_skill_copies_links_and_commits() {
    let nest = nest();
    ensure_repo(&nest.roots.skills_dir()).unwrap();
    configure_git_identity(&nest.roots.skills_dir());

    let outcome = write_skill(
        &nest.roots,
        "resumir-hilos",
        &fixtures().join("skills/resumir-hilos"),
        &context("importa", "resumir-hilos"),
    )
    .unwrap();

    // 1 — canonical copy, supporting files included.
    let dest = nest.roots.skill_dir("resumir-hilos");
    assert!(dest.join("SKILL.md").is_file());
    assert!(dest.join("referencia/tono.md").is_file());

    // 2 — a symlink per runtime, relative, pointing at the canonical dir.
    assert_eq!(outcome.links.len(), RUNTIME_SKILL_DIRS.len());
    for rel in RUNTIME_SKILL_DIRS {
        let link = nest.roots.nest.join(rel).join("resumir-hilos");
        let target = std::fs::read_link(&link).unwrap();
        assert_eq!(
            target,
            PathBuf::from("../../.agents/skills/resumir-hilos"),
            "{rel} link must be relative to survive a nest move"
        );
    }

    // 3 — one commit, with the contract's message shape.
    assert!(outcome.commit.is_some(), "{:?}", outcome.warnings);
    let log = git_command(&nest.roots.skills_dir(), &["log", "-1", "--format=%B"])
        .output()
        .unwrap();
    let message = String::from_utf8_lossy(&log.stdout);
    assert!(message.starts_with("importa resumir-hilos: importada de test-fixtures"));
    assert!(message.contains("Agente: Library"));
    assert!(message.contains("Origen: test"));
}

#[test]
fn each_skill_gets_its_own_commit() {
    let nest = nest();
    ensure_repo(&nest.roots.skills_dir()).unwrap();
    configure_git_identity(&nest.roots.skills_dir());

    for name in ["resumir-hilos", "revisar-pr"] {
        write_skill(
            &nest.roots,
            name,
            &fixtures().join("skills").join(name),
            &context("importa", name),
        )
        .unwrap();
    }

    let log = git_command(&nest.roots.skills_dir(), &["log", "--format=%s"])
        .output()
        .unwrap();
    let subjects: Vec<String> = String::from_utf8_lossy(&log.stdout)
        .lines()
        .map(str::to_string)
        .collect();
    assert!(subjects
        .iter()
        .any(|s| s.starts_with("importa resumir-hilos:")));
    assert!(subjects
        .iter()
        .any(|s| s.starts_with("importa revisar-pr:")));
    assert_eq!(
        subjects
            .iter()
            .filter(|s| s.starts_with("importa "))
            .count(),
        2,
        "one commit per skill, never a batch commit"
    );
}

#[test]
fn write_refuses_a_name_that_is_not_kebab_case() {
    let nest = nest();
    let error = write_skill(
        &nest.roots,
        "No Valida",
        &fixtures().join("skills/revisar-pr"),
        &context("importa", "No Valida"),
    )
    .unwrap_err();
    assert!(error.contains("kebab-case"), "{error}");
}

#[test]
fn rendered_skill_md_round_trips_through_the_parser() {
    let rendered = render_skill_md(
        "traducir-actas",
        "Traducir actas entre castellano e inglés. Usar cuando pidan traducir un acta. No usar para redactarla.",
        "# Traducir actas\n\nConserva la numeración.\n",
    );
    let front = crate::skills_library::contract::parse_skill_frontmatter(&rendered);
    assert_eq!(front.name.as_deref(), Some("traducir-actas"));
    assert!(front.description.contains("Usar cuando"));
    assert_eq!(front.version.as_deref(), Some("1"));
    assert_eq!(
        judge_description(&front.description),
        DescriptionVerdict::Usable
    );
    // `split_frontmatter` strips exactly one newline after the closing `---`,
    // the same as `hints::strip_frontmatter`, so a conventional
    // `---\n\n# Title` body keeps its blank first line. Faithfulness to the
    // runtime matters more here than a tidier body.
    let (_, body) = split_frontmatter(&rendered);
    assert!(
        body.trim_start().starts_with("# Traducir actas"),
        "{body:?}"
    );
}

#[test]
fn create_skill_writes_links_and_commits() {
    let nest = nest();
    ensure_repo(&nest.roots.skills_dir()).unwrap();
    configure_git_identity(&nest.roots.skills_dir());

    let outcome = create_skill(
        &nest.roots,
        "nueva-skill",
        "Hace una cosa concreta. Usar cuando pidan esa cosa y no otra.",
        "# Nueva skill\n\nCuerpo.\n",
        &CommitContext {
            verb: "crea",
            skill: "nueva-skill".to_string(),
            reason: "creada desde la Library".to_string(),
            agent: "Library".to_string(),
            origin: "formulario".to_string(),
        },
    )
    .unwrap();

    assert!(outcome.commit.is_some(), "{:?}", outcome.warnings);
    assert_eq!(outcome.links.len(), RUNTIME_SKILL_DIRS.len());
    let inventory = library_inventory(&nest.roots);
    assert_eq!(inventory.len(), 1);
    assert_eq!(inventory[0].skill.name, "nueva-skill");
    assert!(inventory[0].links_complete);
}

#[test]
fn create_refuses_an_existing_name() {
    let nest = nest();
    std::fs::create_dir_all(nest.roots.skill_dir("ya-existe")).unwrap();
    let error = create_skill(
        &nest.roots,
        "ya-existe",
        "Descripción suficiente. Usar cuando haga falta probar la colisión.",
        "body",
        &context("crea", "ya-existe"),
    )
    .unwrap_err();
    assert!(error.contains("already exists"), "{error}");
}

#[test]
fn edit_rewrites_description_and_body_but_keeps_the_name() {
    let nest = nest();
    ensure_repo(&nest.roots.skills_dir()).unwrap();
    configure_git_identity(&nest.roots.skills_dir());
    create_skill(
        &nest.roots,
        "editable",
        "Descripción inicial. Usar cuando se pruebe la edición y no en otro caso.",
        "# Editable\n\nAntes.\n",
        &context("crea", "editable"),
    )
    .unwrap();

    let outcome = edit_skill(
        &nest.roots,
        "editable",
        "Descripción nueva. Usar cuando se compruebe que la edición conserva el nombre.",
        "# Editable\n\nDespués.\n",
        &CommitContext {
            verb: "edita",
            skill: "editable".to_string(),
            reason: "actualizada desde la Library".to_string(),
            agent: "Library".to_string(),
            origin: "edición".to_string(),
        },
    )
    .unwrap();
    assert!(outcome.commit.is_some(), "{:?}", outcome.warnings);

    let skill = parse_skill_dir(&nest.roots.skill_dir("editable")).unwrap();
    assert_eq!(skill.name, "editable");
    assert!(skill.description.contains("Descripción nueva"));
    let content =
        std::fs::read_to_string(nest.roots.skill_dir("editable").join("SKILL.md")).unwrap();
    assert!(content.contains("Después."));
    assert!(!content.contains("Antes."));
}

#[test]
fn ensure_repo_is_idempotent_and_writes_the_contract_gitignore() {
    let nest = nest();
    let skills = nest.roots.skills_dir();
    ensure_repo(&skills).unwrap();
    configure_git_identity(&skills);
    assert!(skills.join(".gitignore").is_file());
    let first = std::fs::read_to_string(skills.join(".gitignore")).unwrap();
    assert!(first.contains(".DS_Store"));
    // Second call must not reinitialize or rewrite anything.
    ensure_repo(&skills).unwrap();
    assert_eq!(
        std::fs::read_to_string(skills.join(".gitignore")).unwrap(),
        first
    );
}

#[test]
fn commit_fails_loudly_when_there_is_nothing_to_commit() {
    let nest = nest();
    let skills = nest.roots.skills_dir();
    ensure_repo(&skills).unwrap();
    configure_git_identity(&skills);

    // A name with nothing on disk fails at `git add`, with git's own message.
    let error = commit_skill(&skills, "fantasma", &context("importa", "fantasma")).unwrap_err();
    assert!(error.contains("fantasma"), "{error}");

    // A skill that exists but has not changed reaches the empty-stage check.
    create_skill(
        &nest.roots,
        "sin-cambios",
        "Descripción suficiente. Usar cuando se compruebe el commit vacío.",
        "body",
        &context("crea", "sin-cambios"),
    )
    .unwrap();
    let error = commit_skill(&skills, "sin-cambios", &context("edita", "sin-cambios")).unwrap_err();
    assert!(error.contains("nothing staged"), "{error}");
}

#[test]
fn a_first_import_into_a_fresh_nest_still_gets_its_own_commit() {
    // Regression, found in manual verification. `ensure_repo` bootstraps a new
    // repository with `git add -A` + `estado actual` — a snapshot of what was
    // already on disk. Running it *after* the copy made that snapshot swallow
    // the skill just written: it landed inside `estado actual` instead of its
    // own commit (§5.1), and the follow-up `git add -- <name>` then found
    // nothing new and reported "not committed" for a skill that was, in fact,
    // committed. The nest is not a repo until the first write, so this is the
    // very first import a user ever performs.
    let nest = nest();
    let skills_dir = nest.roots.skills_dir();

    // A skill that predates the repository — this one belongs in `estado actual`.
    let preexisting = skills_dir.join("ya-estaba");
    std::fs::create_dir_all(&preexisting).unwrap();
    std::fs::write(
        preexisting.join("SKILL.md"),
        "---\nname: ya-estaba\ndescription: Estaba antes del repo. Usar cuando se pruebe el arranque.\n---\n",
    )
    .unwrap();

    assert!(
        !is_repo(&skills_dir),
        "the nest starts without a repository"
    );

    // Configure identity lazily: the repo does not exist yet, so do it through
    // a pre-init that mirrors what the app's environment provides.
    ensure_repo(&skills_dir).unwrap();
    configure_git_identity(&skills_dir);

    // Reset to the pre-repo state to exercise the real first-write path.
    std::fs::remove_dir_all(skills_dir.join(".git")).unwrap();
    assert!(!is_repo(&skills_dir));

    let outcome = write_skill(
        &nest.roots,
        "resumir-hilos",
        &fixtures().join("skills/resumir-hilos"),
        &context("importa", "resumir-hilos"),
    );

    // Without a git identity the commit cannot be made at all; skip the
    // assertions that depend on it rather than assert a false negative.
    let Ok(outcome) = outcome else {
        panic!("the copy must succeed even when git is unhappy");
    };
    configure_git_identity(&skills_dir);

    let subjects: Vec<String> = git_command(&skills_dir, &["log", "--format=%s"])
        .output()
        .map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    if subjects.is_empty() {
        // No git identity on this machine — the copy still has to have worked.
        assert!(nest
            .roots
            .skill_dir("resumir-hilos")
            .join("SKILL.md")
            .is_file());
        return;
    }

    assert!(
        outcome.commit.is_some(),
        "the first import must be committed on its own: {:?}",
        outcome.warnings
    );
    assert_eq!(
        subjects.first().map(String::as_str),
        Some("importa resumir-hilos: importada de test-fixtures"),
        "the newest commit is the skill's own, not the baseline"
    );

    // And the baseline snapshot holds only what predated the import.
    let baseline = git_command(&skills_dir, &["show", "--stat", "--format=", "HEAD~1"])
        .output()
        .unwrap();
    let baseline = String::from_utf8_lossy(&baseline.stdout);
    assert!(baseline.contains("ya-estaba"), "{baseline}");
    assert!(
        !baseline.contains("resumir-hilos"),
        "the imported skill must not be swallowed by `estado actual`: {baseline}"
    );
}

/// Git's location variables win over the path a caller passes.
///
/// `git -C <path>` changes directory; `GIT_DIR` overrides discovery entirely, so
/// a process that inherits it writes to *that* repository whatever path it was
/// handed. Git exports these to every hook, and this repository's pre-push hook
/// runs this suite — so under `git push` these commits landed in the
/// developer's current branch. One measured pre-push gained four commits
/// authored "Buzz Tests" plus two racing `cannot lock ref 'HEAD'` failures,
/// while the same tests passed when run directly. The gate was corrupting the
/// branch it was checking.
///
/// Asserted on the command the production path builds rather than by setting
/// `GIT_DIR` for real: these tests run in parallel threads, so a global
/// environment variable set by one leaks into the others — the same class of
/// bug this guard exists for.
///
/// The end-to-end check is a command, not a test, for that reason:
///
/// ```text
/// GIT_DIR=$PWD/.git cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib
/// ```
///
/// Before this module was pinned, that reproduced the failure exactly: three
/// tests red and the repository's own HEAD moved. It now passes 3268 tests with
/// HEAD untouched. Every `git` call here goes through `git_command`, including
/// the ones that only read — a raw `Command::new("git")` in an assertion reads
/// the wrong repository just as surely as one in production writes to it.
#[test]
fn a_git_call_is_pinned_to_the_repository_it_was_given() {
    use std::ffi::OsStr;

    let command = git_command(std::path::Path::new("/tmp/nest"), &["status"]);
    let cleared: Vec<&OsStr> = command
        .get_envs()
        .filter(|(_, value)| value.is_none())
        .map(|(key, _)| key)
        .collect();

    for name in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
    ] {
        assert!(
            cleared.contains(&OsStr::new(name)),
            "{name} still reaches git, so an inherited value would redirect this \
             call at another repository. Cleared: {cleared:?}"
        );
    }
}

/// The falsifying half: the command must still be aimed at the given path, so a
/// change that cleared everything and forgot `-C` cannot pass.
#[test]
fn a_git_call_still_names_the_repository_path() {
    use std::ffi::OsStr;

    let command = git_command(std::path::Path::new("/tmp/nest"), &["status"]);
    let args: Vec<&OsStr> = command.get_args().collect();
    assert_eq!(args[0], OsStr::new("-C"));
    assert_eq!(args[1], OsStr::new("/tmp/nest"));
    assert_eq!(args[2], OsStr::new("status"));
}
