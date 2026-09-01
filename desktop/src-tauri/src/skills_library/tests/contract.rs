//! Parsers for `SKILL.md` and the eval contract (spec §2.2, §3).

use super::{fixtures, nest};
use crate::skills_library::contract::{
    list_agent_eval_listing, list_agent_evals, parse_bulletin, parse_eval_case, parse_feedback_log,
    parse_skill_dir, parse_skill_frontmatter, read_agent_evals, split_frontmatter,
};
use crate::skills_library::names::DescriptionVerdict;
use std::path::{Path, PathBuf};

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

/// R7 — a `puntuacion` outside 0.00–1.00 makes the bulletin invalid (§3.4).
///
/// The three cases live in one test on purpose: what matters is not that each
/// verdict is right in isolation but that "absent" lands on the *other* side of
/// the line from "out of range". Split across three tests, a regression that
/// collapses them into one branch still leaves two of the three green.
#[test]
fn bulletin_reports_a_score_out_of_range_but_not_a_missing_one() {
    let out_of_range = parse_bulletin(
        "---\nfecha: 2026-01-01\nrunner: manual\npuntuacion: 1.5\ntendencia: estable\n---\n",
    );
    assert!(
        out_of_range.problems.iter().any(|p| p.code == "badScore"),
        "1.5 is outside 0.00-1.00 and must be reported"
    );

    // R7b — a legible bulletin with no score is legitimate, not invalid.
    let absent =
        parse_bulletin("---\nfecha: 2026-01-01\nrunner: manual\ntendencia: estable\n---\n");
    assert_eq!(
        absent.problems.len(),
        0,
        "an absent `puntuacion` must report nothing at all, got {:?}",
        absent.problems
    );

    let in_range = parse_bulletin(
        "---\nfecha: 2026-01-01\nrunner: manual\npuntuacion: 0.75\ntendencia: estable\n---\n",
    );
    assert_eq!(
        in_range.problems.len(),
        0,
        "0.75 is valid and must report nothing, got {:?}",
        in_range.problems
    );
}

/// R3 — the listing carries the root it read, even when it read nothing.
///
/// The absent-root case is the one that matters: the agent list is empty for a
/// missing root and for an empty one alike, so without the path the UI cannot
/// tell "no evals yet" from "looking at the wrong directory".
#[test]
fn eval_listing_carries_the_root_it_looked_at_even_when_absent() {
    let missing = fixtures().join("evals-no-such-root");
    assert!(
        !missing.exists(),
        "this path must not exist for the test to mean anything"
    );

    let listing = list_agent_eval_listing(&missing);
    assert_eq!(listing.root, missing.to_string_lossy());
    assert!(
        listing.agents.is_empty(),
        "a missing root lists no agents, got {}",
        listing.agents.len()
    );

    // Control: a root that does exist reports the same path and finds agents,
    // so the assertion above is about the root being absent, not about the
    // field being hardcoded.
    let present = fixtures().join("evals");
    let found = list_agent_eval_listing(&present);
    assert_eq!(found.root, present.to_string_lossy());
    assert!(
        !found.agents.is_empty(),
        "the fixture root has agents; an empty result would mean this test proves nothing"
    );
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

// ── list_agent_evals (I1: listing every folder under evals_dir()) ─────────

/// Minimal but syntactically valid `caso-NN.md`, so `read_agent_evals` per
/// folder reports it as a real case rather than a parse problem.
fn valid_case_md(n: u32) -> String {
    format!(
        "---\ncaso: {n}\ntitulo: t\norigen: nacimiento\nfecha: 2026-01-01\nautor: a\n---\n\n## Input\n\ni\n\n## Output esperado\n\no\n"
    )
}

#[test]
fn list_agent_evals_lists_every_subdirectory_sorted_with_matching_counts() {
    let nest = nest();
    let evals_root = nest.roots.evals_dir();

    // Three synthetic agents: cases + no bulletin, more cases, and an empty
    // directory — the normal "nobody has written evals for this agent yet"
    // state ([`read_agent_evals`]'s own doc comment), just at the listing
    // level instead of for one already-known agent.
    std::fs::create_dir_all(evals_root.join("zzz-agent")).unwrap();
    std::fs::write(evals_root.join("zzz-agent/caso-01.md"), valid_case_md(1)).unwrap();

    std::fs::create_dir_all(evals_root.join("aaa-agent")).unwrap();
    std::fs::write(evals_root.join("aaa-agent/caso-01.md"), valid_case_md(1)).unwrap();
    std::fs::write(evals_root.join("aaa-agent/caso-02.md"), valid_case_md(2)).unwrap();

    std::fs::create_dir_all(evals_root.join("empty-agent")).unwrap();

    let summaries = list_agent_evals(&evals_root);

    // Reverification: an independent walk of the root taken right now, not a
    // hardcoded count — this is the "coincide con una reverificación manual
    // en el momento del test" half of I1's criterion (a), done against a
    // deterministic fixture instead of one developer's home directory (see
    // `list_agent_evals_matches_the_real_dev_nest` below for the literal
    // real-nest check).
    let mut expected_dirs: Vec<String> = std::fs::read_dir(&evals_root)
        .unwrap()
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    expected_dirs.sort();

    assert_eq!(
        summaries
            .iter()
            .map(|s| s.dir_name.clone())
            .collect::<Vec<_>>(),
        expected_dirs,
        "listing must cover every folder under the root, sorted by name"
    );

    let aaa = summaries
        .iter()
        .find(|s| s.dir_name == "aaa-agent")
        .unwrap();
    assert_eq!(aaa.evals.cases.len(), 2);

    let zzz = summaries
        .iter()
        .find(|s| s.dir_name == "zzz-agent")
        .unwrap();
    assert_eq!(zzz.evals.cases.len(), 1);

    let empty = summaries
        .iter()
        .find(|s| s.dir_name == "empty-agent")
        .unwrap();
    assert!(
        empty.evals.exists,
        "an existing empty directory is still `exists`"
    );
    assert!(empty.evals.cases.is_empty());
}

#[test]
fn list_agent_evals_on_a_missing_root_is_empty_not_an_error() {
    let summaries = list_agent_evals(Path::new("/nonexistent/evals/root"));
    assert!(summaries.is_empty());
}

/// I1 criterion (b): a snapshot of mtime + size for every file and directory
/// under the root, taken before and after the listing, must be identical.
/// Runs against the real fixture tree (not a throwaway nest) precisely
/// because it is checking that *reading* never writes — a tempdir the test
/// itself just created would not catch a regression that only shows up on
/// filesystems that update `atime`/metadata differently.
#[test]
fn list_agent_evals_does_not_modify_anything_on_disk() {
    fn snapshot(dir: &Path, out: &mut Vec<(PathBuf, std::time::SystemTime, u64)>) {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            let meta = entry.metadata().unwrap();
            out.push((path.clone(), meta.modified().unwrap(), meta.len()));
            if meta.is_dir() {
                snapshot(&path, out);
            }
        }
    }

    let root = fixtures().join("evals");

    let mut before = Vec::new();
    snapshot(&root, &mut before);
    before.sort_by(|a, b| a.0.cmp(&b.0));

    let _ = list_agent_evals(&root);

    let mut after = Vec::new();
    snapshot(&root, &mut after);
    after.sort_by(|a, b| a.0.cmp(&b.0));

    assert_eq!(
        before, after,
        "listing must not change mtime or size of anything under the root"
    );
}

/// I1 criterion (c): a subdirectory that is a symlink resolving outside the
/// root is excluded from the listing, not followed — the same containment
/// rule `paths::resolve_within` applies everywhere else in this module
/// (`paths.rs` §7), exercised here for the one reader that walks the root
/// itself instead of being handed an already-resolved agent directory.
#[test]
#[cfg(unix)]
fn list_agent_evals_excludes_a_symlinked_subdirectory_that_escapes_the_root() {
    let nest = nest();
    let evals_root = nest.roots.evals_dir();

    std::fs::create_dir_all(evals_root.join("real-agent")).unwrap();
    std::fs::write(evals_root.join("real-agent/caso-01.md"), valid_case_md(1)).unwrap();

    let outside = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(outside.path().join("secreto")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("secreto"), evals_root.join("escapada"))
        .unwrap();

    let summaries = list_agent_evals(&evals_root);

    assert_eq!(
        summaries.len(),
        1,
        "the symlinked escape must not be read: {summaries:?}"
    );
    assert_eq!(summaries[0].dir_name, "real-agent");
}

/// I1 criterion (a), literally: against the real dev nest (`~/.buzz-dev`),
/// the listing agrees with a fresh recount taken at the same moment.
///
/// Not run by default `cargo test` (`#[ignore]`): a developer's own evals
/// folder is not a fixture. Its folder count and contents change day to day
/// and do not exist at all on a fresh machine or in CI — asserting against
/// it there would make this suite non-reproducible, which is the thing
/// `list_agent_evals_lists_every_subdirectory_sorted_with_matching_counts`
/// above exists to test deterministically instead. Run explicitly to
/// reverify against the real disk when that is what's being asked:
/// `cargo test --manifest-path desktop/src-tauri/Cargo.toml list_agent_evals_matches_the_real_dev_nest -- --ignored --nocapture`
#[test]
#[ignore]
fn list_agent_evals_matches_the_real_dev_nest() {
    let evals_root = dirs::home_dir()
        .expect("home directory must resolve")
        .join(".buzz-dev/.agents/evals");

    let summaries = list_agent_evals(&evals_root);

    let mut expected: Vec<String> = std::fs::read_dir(&evals_root)
        .unwrap()
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    expected.sort();

    assert_eq!(
        summaries
            .iter()
            .map(|s| s.dir_name.clone())
            .collect::<Vec<_>>(),
        expected,
        "list_agent_evals must cover exactly the folders under ~/.buzz-dev/.agents/evals right now"
    );

    println!(
        "{} carpetas listadas bajo ~/.buzz-dev/.agents/evals: {:?}",
        summaries.len(),
        expected
    );
}
