//! The import preview: collisions and unusable descriptions (spec §4.1, §4.3).

use super::{fixtures, nest};
use crate::skills_library::import::{is_skill_dir, plan_import, source_skill_dirs};
use crate::skills_library::names::DescriptionVerdict;

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
