//! The path allow-list: what the library may read and write (spec §7).

use super::nest;
use crate::skills_library::paths::{
    resolve_import_source, resolve_new_within, resolve_within, PathDenied, RUNTIME_SKILL_DIRS,
};
use std::path::Path;

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
