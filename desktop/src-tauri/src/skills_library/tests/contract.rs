//! Parsers for `SKILL.md` and the eval contract (spec §2.2, §3).

use super::fixtures;
use crate::skills_library::contract::{
    parse_bulletin, parse_eval_case, parse_feedback_log, parse_skill_dir, parse_skill_frontmatter,
    read_agent_evals, split_frontmatter,
};
use crate::skills_library::names::DescriptionVerdict;
use std::path::Path;

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
