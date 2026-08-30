//! Skill-name validation and the description heuristic (spec §2.1, §2.3).

use crate::skills_library::names::{
    description_hint, judge_description, slugify, validate_skill_name, DescriptionVerdict,
    NameError,
};

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
