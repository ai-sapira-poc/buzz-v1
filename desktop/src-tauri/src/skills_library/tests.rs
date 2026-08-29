//! Unit tests for the on-disk contract, discovery, name rules and the write
//! path. Fixtures come from `test-fixtures/agent-profile/`, so no test needs a
//! real skill directory or a real agent.

use std::path::{Path, PathBuf};

use super::contract::{
    parse_bulletin, parse_eval_case, parse_feedback_log, parse_skill_dir, parse_skill_frontmatter,
    read_agent_evals, split_frontmatter,
};
use super::discovery::{library_inventory, runtime_skill_view, SkillScope, CWD_SKILL_DIRS};
use super::import::{is_skill_dir, plan_import, source_skill_dirs};
use super::names::{
    description_hint, judge_description, slugify, validate_skill_name, DescriptionVerdict,
    NameError,
};
use super::paths::{
    resolve_import_source, resolve_new_within, resolve_within, LibraryRoots, PathDenied,
    RUNTIME_SKILL_DIRS,
};
use super::writer::{
    commit_skill, copy_skill_tree, create_skill, edit_skill, ensure_repo, ensure_runtime_links,
    render_skill_md, write_skill, CommitContext,
};

/// `test-fixtures/agent-profile`, resolved from this crate's manifest dir.
fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../test-fixtures/agent-profile")
        .canonicalize()
        .expect("fixtures directory must exist")
}

/// A throwaway nest: `<tmp>/.agents/skills` and the runtime link dirs.
struct Nest {
    _dir: tempfile::TempDir,
    roots: LibraryRoots,
}

fn nest() -> Nest {
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
fn configure_git_identity(repo: &Path) {
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

// ── Names ────────────────────────────────────────────────────────────────────

#[test]
fn kebab_case_names_are_accepted() {
    for name in [
        "a",
        "resumir-hilos",
        "skill-2",
        "qa-inspeccion-visual",
        "x1",
    ] {
        assert!(validate_skill_name(name).is_ok(), "{name} should be valid");
    }
}

#[test]
fn non_kebab_case_names_are_rejected() {
    for name in [
        "Resumir-Hilos",
        "resumir hilos",
        "resumir_hilos",
        "-leading",
        "trailing-",
        "double--hyphen",
        "acentuación",
        "../escape",
        "skill/nested",
    ] {
        assert_eq!(
            validate_skill_name(name),
            Err(NameError::NotKebabCase),
            "{name} should be rejected"
        );
    }
    assert_eq!(validate_skill_name(""), Err(NameError::Empty));
    assert_eq!(
        validate_skill_name(&"a".repeat(65)),
        Err(NameError::TooLong)
    );
}

#[test]
fn slugify_folds_accents_and_separators() {
    assert_eq!(slugify("Ana — Soporte"), "ana-soporte");
    assert_eq!(slugify("Diseño  UX"), "diseno-ux");
    assert_eq!(slugify("QA / Inspección Visual"), "qa-inspeccion-visual");
    assert_eq!(slugify("  "), "");
}

#[test]
fn description_verdicts_match_the_contract() {
    assert_eq!(judge_description(""), DescriptionVerdict::Missing);
    assert_eq!(judge_description("   \n "), DescriptionVerdict::Missing);
    // Short: cannot state what it does and when not to use it.
    assert_eq!(
        judge_description("Ayuda con cosas."),
        DescriptionVerdict::Generic
    );
    // Long enough but with no trigger — the hijack case.
    assert_eq!(
        judge_description(
            "Una skill muy completa que sirve para muchísimas tareas distintas del equipo."
        ),
        DescriptionVerdict::Generic
    );
    assert_eq!(
        judge_description(
            "Resumir un hilo largo en decisiones y pendientes. Usar cuando pidan el resumen de una conversación."
        ),
        DescriptionVerdict::Usable
    );
    assert_eq!(
        judge_description(
            "Review a pull request for correctness bugs. Use when someone asks to review a diff."
        ),
        DescriptionVerdict::Usable
    );
}

#[test]
fn only_flagged_descriptions_carry_a_hint() {
    assert!(description_hint(DescriptionVerdict::Usable).is_none());
    assert!(description_hint(DescriptionVerdict::Generic).is_some());
    assert!(description_hint(DescriptionVerdict::Missing).is_some());
}

// ── Contract parsing ─────────────────────────────────────────────────────────

#[test]
fn frontmatter_framing_matches_hints() {
    let (yaml, body) = split_frontmatter("---\nname: a\n---\nbody\n");
    assert_eq!(yaml, Some("name: a"));
    assert_eq!(body, "body\n");

    // No frontmatter at all: everything is body, as the runtime treats it.
    let (yaml, body) = split_frontmatter("# just a heading\n");
    assert_eq!(yaml, None);
    assert_eq!(body, "# just a heading\n");

    // Unterminated block is not frontmatter.
    let (yaml, _) = split_frontmatter("---\nname: a\n");
    assert_eq!(yaml, None);
}

#[test]
fn skill_fixture_parses_with_supporting_files() {
    let skill = parse_skill_dir(&fixtures().join("skills/resumir-hilos")).unwrap();
    assert_eq!(skill.name, "resumir-hilos");
    assert_eq!(skill.dir_name, "resumir-hilos");
    assert!(skill.discoverable);
    assert_eq!(skill.description_verdict, DescriptionVerdict::Usable);
    assert_eq!(
        skill.supporting_files,
        vec!["referencia/tono.md".to_string()]
    );
    assert!(skill.problems.is_empty(), "{:?}", skill.problems);
}

#[test]
fn a_skill_without_name_is_reported_not_hidden() {
    // The runtime drops this one in silence (hints.rs:105). The library must
    // still list it, with the reason — otherwise the user has no way to learn
    // why their skill "doesn't exist".
    let skill = parse_skill_dir(&fixtures().join("skills/sin-nombre")).unwrap();
    assert!(!skill.discoverable);
    assert_eq!(skill.name, "sin-nombre", "falls back to the directory name");
    assert!(skill.problems.iter().any(|p| p.code == "missingName"));
}

#[test]
fn frontmatter_reads_name_description_and_version() {
    let front = parse_skill_frontmatter("---\nname: x\ndescription: d\nversion: 2\n---\nbody");
    assert_eq!(front.name.as_deref(), Some("x"));
    assert_eq!(front.description, "d");
    assert_eq!(front.version.as_deref(), Some("2"));

    // Empty `name` is the same as no `name`.
    let front = parse_skill_frontmatter("---\nname: \"   \"\n---\n");
    assert_eq!(front.name, None);
}

#[test]
fn eval_case_fixture_parses() {
    let content = std::fs::read_to_string(fixtures().join("evals/ana-soporte/caso-01.md")).unwrap();
    let case = parse_eval_case("caso-01.md", &content);
    assert_eq!(case.number, 1);
    assert_eq!(case.origin, "nacimiento");
    assert_eq!(case.date, "2026-08-20");
    assert_eq!(case.author, "guillermo");
    assert!(case.title.starts_with("Resume un hilo largo"));
    assert!(case.input.contains("40 mensajes"));
    assert!(case.expected.contains("sin cerrar"));
    assert!(case.problems.is_empty(), "{:?}", case.problems);
}

#[test]
fn eval_case_reports_a_bad_origin_and_missing_sections() {
    let case = parse_eval_case(
        "caso-07.md",
        "---\ncaso: 7\ntitulo: t\norigen: inventado\nfecha: 2026-01-01\nautor: a\n---\n\n## Input\n\nx\n",
    );
    assert!(case.problems.iter().any(|p| p.code == "badOrigin"));
    assert!(case.problems.iter().any(|p| p.code == "missingExpected"));
    assert_eq!(case.number, 7);
}

#[test]
fn eval_case_reports_a_number_mismatch_between_name_and_frontmatter() {
    let case = parse_eval_case(
        "caso-03.md",
        "---\ncaso: 9\ntitulo: t\norigen: feedback\nfecha: 2026-01-01\nautor: a\n---\n\n## Input\n\ni\n\n## Output esperado\n\no\n",
    );
    assert!(case.problems.iter().any(|p| p.code == "caseNumberMismatch"));
}

#[test]
fn feedback_log_fixture_parses_newest_first() {
    let content =
        std::fs::read_to_string(fixtures().join("evals/ana-soporte/feedback-log.md")).unwrap();
    let entries = parse_feedback_log(&content);
    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0].date, "2026-08-29");
    assert_eq!(entries[0].author, "guillermo");
    assert_eq!(entries[0].status, "corregido");
    assert_eq!(entries[0].linked_case.as_deref(), Some("caso-02"));
    assert!(entries[0].body.contains("opción B"));
    assert_eq!(entries[2].status, "abierto");
    assert_eq!(entries[2].linked_case, None);
}

#[test]
fn bulletin_fixture_parses_scores_and_trend() {
    let content =
        std::fs::read_to_string(fixtures().join("evals/ana-soporte/boletin-ultimo.md")).unwrap();
    let bulletin = parse_bulletin(&content);
    assert_eq!(bulletin.date, "2026-08-29");
    assert_eq!(bulletin.runner, "manual");
    assert_eq!(bulletin.score, "0.75");
    assert_eq!(bulletin.trend, "sube");
    assert_eq!(
        bulletin.rows.len(),
        2,
        "header and separator rows are dropped"
    );
    assert_eq!(bulletin.rows[0].case, "caso-01");
    assert_eq!(bulletin.rows[0].score, "1.00");
    assert!(bulletin.problems.is_empty());
}

#[test]
fn bulletin_reports_an_unknown_trend() {
    let bulletin = parse_bulletin(
        "---\nfecha: 2026-01-01\nrunner: manual\npuntuacion: 0.5\ntendencia: regular\n---\n",
    );
    assert!(bulletin.problems.iter().any(|p| p.code == "badTrend"));
}

#[test]
fn agent_evals_fixture_reads_whole() {
    let evals = read_agent_evals(&fixtures().join("evals/ana-soporte"));
    assert!(evals.exists);
    assert_eq!(evals.cases.len(), 2);
    assert_eq!(evals.cases[0].number, 1);
    assert_eq!(evals.cases[1].origin, "feedback");
    assert_eq!(evals.feedback.len(), 3);
    assert!(evals.bulletin.is_some());
    assert!(
        evals.discrepancies.is_empty(),
        "fixture is consistent: {:?}",
        evals.discrepancies
    );
}

#[test]
fn agent_evals_reports_a_case_scored_but_absent() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("boletin-ultimo.md"),
        "---\nfecha: 2026-01-01\nrunner: manual\npuntuacion: 1.00\ntendencia: primera\n---\n\n| Caso | Puntuación | Nota |\n|---|---|---|\n| caso-04 | 1.00 | x |\n",
    )
    .unwrap();
    let evals = read_agent_evals(dir.path());
    assert_eq!(evals.discrepancies.len(), 1);
    assert!(evals.discrepancies[0].contains("caso-04"));
}

#[test]
fn a_missing_eval_directory_is_empty_not_an_error() {
    let evals = read_agent_evals(Path::new("/nonexistent/evals/nadie"));
    assert!(!evals.exists);
    assert!(evals.cases.is_empty());
}

// ── Path guard ───────────────────────────────────────────────────────────────

#[test]
fn resolve_within_accepts_a_path_inside_a_root() {
    let nest = nest();
    let skills = nest.roots.skills_dir();
    std::fs::create_dir_all(skills.join("uno")).unwrap();
    assert!(resolve_within(&skills.join("uno"), std::slice::from_ref(&skills)).is_ok());
}

#[test]
fn resolve_within_refuses_traversal_and_outside_paths() {
    let nest = nest();
    let skills = nest.roots.skills_dir();

    assert_eq!(
        resolve_within(&skills.join("../evals"), std::slice::from_ref(&skills)),
        Err(PathDenied::Traversal),
        "a literal .. never even reaches the filesystem"
    );
    assert_eq!(
        resolve_within(Path::new("/etc"), std::slice::from_ref(&skills)),
        Err(PathDenied::OutsideRoots)
    );
    assert_eq!(
        resolve_within(&skills.join("missing"), std::slice::from_ref(&skills)),
        Err(PathDenied::Unresolvable)
    );
}

#[test]
#[cfg(unix)]
fn resolve_within_refuses_a_symlink_that_escapes_the_root() {
    // This is the case a string prefix check would wave through: a path that
    // *looks* like it is inside the root and resolves outside it.
    let nest = nest();
    let skills = nest.roots.skills_dir();
    let outside = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(outside.path().join("secreto")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("secreto"), skills.join("escapada")).unwrap();

    assert_eq!(
        resolve_within(&skills.join("escapada"), std::slice::from_ref(&skills)),
        Err(PathDenied::OutsideRoots)
    );
}

#[test]
fn resolve_new_within_allows_a_new_child_but_not_an_escape() {
    let nest = nest();
    let skills = nest.roots.skills_dir();
    assert!(resolve_new_within(&skills.join("nueva"), std::slice::from_ref(&skills)).is_ok());
    assert_eq!(
        resolve_new_within(&skills.join("../fuera"), std::slice::from_ref(&skills)),
        Err(PathDenied::Traversal)
    );
}

#[test]
fn import_sources_are_limited_to_standing_roots_or_the_users_pick() {
    let nest = nest();
    let elsewhere = tempfile::tempdir().unwrap();
    let picked = elsewhere.path().join("skills");
    std::fs::create_dir_all(&picked).unwrap();

    // Not picked, not standing: refused.
    assert_eq!(
        resolve_import_source(&picked, &nest.roots, None),
        Err(PathDenied::OutsideRoots)
    );
    // The user's own pick authorizes it, for this operation.
    assert!(resolve_import_source(&picked, &nest.roots, Some(&picked)).is_ok());
    // A pick does not widen the guard to the whole filesystem.
    assert_eq!(
        resolve_import_source(Path::new("/etc"), &nest.roots, Some(&picked)),
        Err(PathDenied::OutsideRoots)
    );
}

#[test]
fn managed_roots_cover_skills_evals_and_runtime_dirs() {
    let nest = nest();
    let roots = nest.roots.managed_roots();
    assert!(roots.contains(&nest.roots.skills_dir()));
    assert!(roots.contains(&nest.roots.evals_dir()));
    for rel in RUNTIME_SKILL_DIRS {
        assert!(roots.contains(&nest.roots.nest.join(rel)), "{rel} missing");
    }
}

// ── Discovery ────────────────────────────────────────────────────────────────

#[test]
fn discovery_order_matches_the_hints_constant() {
    // Pinned deliberately: the order decides who wins a name collision. If
    // hints.rs ever reorders SKILL_DIRS, this test is the tripwire.
    assert_eq!(
        CWD_SKILL_DIRS,
        &[".agents/skills", ".goose/skills", ".claude/skills"]
    );
}

#[test]
fn runtime_view_marks_a_shadowed_skill() {
    let nest = nest();
    // Same name in the canonical dir and in the claude dir. `.agents/skills` is
    // scanned first, so the claude copy is shadowed and the runtime never sees
    // it — silently, which is exactly what the profile must surface.
    for dir in [".agents/skills/dup", ".claude/skills/dup"] {
        let path = nest.roots.nest.join(dir);
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(
            path.join("SKILL.md"),
            "---\nname: dup\ndescription: Hace algo concreto. Usar cuando pidan justo eso.\n---\n\nx\n",
        )
        .unwrap();
    }

    let view = runtime_skill_view("buzz-agent", &nest.roots);
    let dups: Vec<_> = view
        .skills
        .iter()
        .filter(|s| s.skill.name == "dup")
        .collect();
    assert_eq!(dups.len(), 2);
    assert!(!dups[0].shadowed, "the .agents copy wins");
    assert_eq!(dups[0].source_dir, ".agents/skills");
    assert!(dups[1].shadowed, "the .claude copy is discarded in silence");
    assert_eq!(dups[1].shadowed_by.as_deref(), Some(".agents/skills"));
}

#[test]
fn runtime_view_separates_nest_from_machine_global() {
    let dir = tempfile::tempdir().unwrap();
    let nest_root = dir.path().join("nest");
    let home = dir.path().join("home");
    std::fs::create_dir_all(nest_root.join(".agents/skills/del-nest")).unwrap();
    std::fs::write(
        nest_root.join(".agents/skills/del-nest/SKILL.md"),
        "---\nname: del-nest\ndescription: Algo del nest. Usar cuando toque el nest y no otra cosa.\n---\n",
    )
    .unwrap();
    std::fs::create_dir_all(home.join(".agents/skills/de-la-maquina")).unwrap();
    std::fs::write(
        home.join(".agents/skills/de-la-maquina/SKILL.md"),
        "---\nname: de-la-maquina\ndescription: Algo global. Usar cuando sea global y no del nest.\n---\n",
    )
    .unwrap();

    let roots = LibraryRoots::new(nest_root, home);
    let view = runtime_skill_view("buzz-agent", &roots);
    let scopes: Vec<_> = view
        .skills
        .iter()
        .map(|s| (s.skill.name.as_str(), s.scope))
        .collect();
    assert!(scopes.contains(&("del-nest", SkillScope::Nest)));
    assert!(scopes.contains(&("de-la-maquina", SkillScope::MachineGlobal)));
}

#[test]
fn claude_also_sees_its_own_user_directory() {
    let dir = tempfile::tempdir().unwrap();
    let nest_root = dir.path().join("nest");
    let home = dir.path().join("home");
    std::fs::create_dir_all(nest_root.join(".agents/skills")).unwrap();
    std::fs::create_dir_all(home.join(".claude/skills/solo-claude")).unwrap();
    std::fs::write(
        home.join(".claude/skills/solo-claude/SKILL.md"),
        "---\nname: solo-claude\ndescription: Sólo la ve claude. Usar cuando el runtime sea claude.\n---\n",
    )
    .unwrap();

    let roots = LibraryRoots::new(nest_root, home);

    let claude = runtime_skill_view("claude", &roots);
    assert!(claude.skills.iter().any(|s| s.skill.name == "solo-claude"));
    assert!(claude
        .skills
        .iter()
        .any(|s| s.scope == SkillScope::RuntimeOwned));

    // buzz-agent does not read ~/.claude/skills at all.
    let buzz = runtime_skill_view("buzz-agent", &roots);
    assert!(!buzz.skills.iter().any(|s| s.skill.name == "solo-claude"));
}

#[test]
#[cfg(unix)]
fn discovery_follows_symlinked_skill_directories() {
    // Every runtime link in the nest is a symlink. `DirEntry::file_type` would
    // report Symlink and hide all of them — the trap hints.rs documents.
    let nest = nest();
    let real = nest.roots.skills_dir().join("real");
    std::fs::create_dir_all(&real).unwrap();
    std::fs::write(
        real.join("SKILL.md"),
        "---\nname: real\ndescription: Una skill real. Usar cuando haga falta lo que hace.\n---\n",
    )
    .unwrap();
    let link_dir = nest.roots.nest.join(".claude/skills");
    std::fs::create_dir_all(&link_dir).unwrap();
    std::os::unix::fs::symlink("../../.agents/skills/real", link_dir.join("real")).unwrap();

    let view = runtime_skill_view("buzz-agent", &nest.roots);
    let seen: Vec<_> = view
        .skills
        .iter()
        .filter(|s| s.skill.name == "real")
        .collect();
    assert_eq!(seen.len(), 2, "the symlinked copy is discovered too");
}

#[test]
fn inventory_reports_missing_runtime_links() {
    let nest = nest();
    let dir = nest.roots.skills_dir().join("suelta");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("SKILL.md"),
        "---\nname: suelta\ndescription: Sin symlinks todavía. Usar cuando se pruebe el inventario.\n---\n",
    )
    .unwrap();

    let inventory = library_inventory(&nest.roots);
    assert_eq!(inventory.len(), 1);
    assert!(!inventory[0].links_complete);
    assert_eq!(inventory[0].missing_links.len(), RUNTIME_SKILL_DIRS.len());

    ensure_runtime_links(&nest.roots, "suelta");
    let inventory = library_inventory(&nest.roots);
    assert!(
        inventory[0].links_complete,
        "{:?}",
        inventory[0].missing_links
    );
}

// ── Import planning ──────────────────────────────────────────────────────────

#[test]
fn a_directory_of_skills_and_a_single_skill_are_told_apart() {
    let origin = fixtures().join("import-origen");
    assert!(!is_skill_dir(&origin));
    assert_eq!(source_skill_dirs(&origin).len(), 3);

    let single = origin.join("traducir-actas");
    assert!(is_skill_dir(&single));
    assert_eq!(source_skill_dirs(&single), vec![single]);
}

#[test]
fn import_preview_flags_a_collision_and_a_missing_description() {
    // The fixture is built for exactly this: one skill that collides with an
    // existing name and one with no description at all.
    let nest = nest();
    let existing = nest.roots.skills_dir().join("resumir-hilos");
    std::fs::create_dir_all(&existing).unwrap();
    std::fs::write(
        existing.join("SKILL.md"),
        "---\nname: resumir-hilos\ndescription: Ya existe. Usar cuando ya exista.\n---\n",
    )
    .unwrap();

    let preview = plan_import(&fixtures().join("import-origen"), &nest.roots);
    assert!(!preview.single_skill);
    assert_eq!(preview.candidates.len(), 3);

    let collision = preview
        .candidates
        .iter()
        .find(|c| c.skill.name == "resumir-hilos")
        .expect("collision candidate");
    assert!(collision.collides_with_existing);
    assert!(
        collision.blocked,
        "a collision must be resolved, never overwritten"
    );
    assert_eq!(collision.suggested_name.as_deref(), Some("resumir-hilos-2"));

    let no_description = preview
        .candidates
        .iter()
        .find(|c| c.skill.name == "redactar-notas")
        .expect("description candidate");
    assert_eq!(
        no_description.description_verdict,
        DescriptionVerdict::Missing
    );
    assert!(no_description.blocked);
    assert!(no_description.description_hint.is_some());
    assert!(!no_description.collides_with_existing);

    let clean = preview
        .candidates
        .iter()
        .find(|c| c.skill.name == "traducir-actas")
        .expect("clean candidate");
    assert!(!clean.blocked);
    assert_eq!(clean.description_verdict, DescriptionVerdict::Usable);
    assert!(clean.suggested_name.is_none());
}

#[test]
fn import_preview_flags_a_collision_inside_one_batch() {
    let nest = nest();
    let source = tempfile::tempdir().unwrap();
    for dir in ["a", "b"] {
        let path = source.path().join(dir);
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(
            path.join("SKILL.md"),
            "---\nname: misma\ndescription: Dos carpetas, un nombre. Usar cuando se pruebe el lote.\n---\n",
        )
        .unwrap();
    }
    let preview = plan_import(source.path(), &nest.roots);
    assert_eq!(preview.candidates.len(), 2);
    assert!(!preview.candidates[0].collides_within_batch);
    assert!(preview.candidates[1].collides_within_batch);
    assert!(preview.candidates[1].blocked);
}

// ── Writing ──────────────────────────────────────────────────────────────────

fn context(verb: &'static str, skill: &str) -> CommitContext {
    CommitContext {
        verb,
        skill: skill.to_string(),
        reason: "importada de test-fixtures".to_string(),
        agent: "Library".to_string(),
        origin: "test".to_string(),
    }
}

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
    let log = std::process::Command::new("git")
        .arg("-C")
        .arg(nest.roots.skills_dir())
        .args(["log", "-1", "--format=%B"])
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

    let log = std::process::Command::new("git")
        .arg("-C")
        .arg(nest.roots.skills_dir())
        .args(["log", "--format=%s"])
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
    let front = super::contract::parse_skill_frontmatter(&rendered);
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
