import * as React from "react";

/**
 * Panel state for the Skills library rail.
 *
 * Module-level snapshot + `useSyncExternalStore`, the same idiom as
 * `features/artifacts/artifactPanelStore.ts` and
 * `features/terminal/terminalPanelStore.ts`. The project has no store library;
 * this is the blessed shape for global UI state that is neither server state
 * (TanStack Query) nor URL state (TanStack Router).
 */

/** What the panel is showing. */
export type SkillsLibraryView =
  | { kind: "list" }
  | { kind: "detail"; name: string }
  | { kind: "import" }
  | { kind: "create" }
  | { kind: "edit"; name: string };

type Snapshot = {
  open: boolean;
  view: SkillsLibraryView;
  query: string;
};

const CLOSED: Snapshot = { open: false, view: { kind: "list" }, query: "" };

let snapshot: Snapshot = CLOSED;
const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function openSkillsLibrary(view?: SkillsLibraryView) {
  publish({ ...snapshot, open: true, view: view ?? { kind: "list" } });
}

export function closeSkillsLibrary() {
  if (!snapshot.open) return;
  publish({ ...snapshot, open: false });
}

export function toggleSkillsLibrary() {
  if (snapshot.open) {
    closeSkillsLibrary();
    return;
  }
  openSkillsLibrary();
}

export function setSkillsLibraryView(view: SkillsLibraryView) {
  publish({ ...snapshot, view });
}

export function setSkillsLibraryQuery(query: string) {
  if (snapshot.query === query) return;
  publish({ ...snapshot, query });
}

export function useSkillsLibraryPanel() {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

export function resetSkillsLibraryForTests() {
  snapshot = CLOSED;
}

export function getSkillsLibrarySnapshotForTests() {
  return snapshot;
}
