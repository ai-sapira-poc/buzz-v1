//! Discovery order, scope and shadowing (spec §1.2, §1.3).

use super::nest;
use crate::skills_library::discovery::{
    library_inventory, runtime_skill_view, SkillScope, CWD_SKILL_DIRS,
};
use crate::skills_library::paths::{LibraryRoots, RUNTIME_SKILL_DIRS};
use crate::skills_library::writer::ensure_runtime_links;

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
