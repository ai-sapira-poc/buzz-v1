import * as React from "react";

import type { ArtifactKind } from "@/shared/lib/artifactKind";

/**
 * Panel state for the artifact preview rail.
 *
 * Module-level snapshot + `useSyncExternalStore`, mirroring
 * `features/terminal/terminalPanelStore.ts`. The project has no store library;
 * this is the blessed idiom for global UI state that is neither server state
 * (TanStack Query) nor URL state (TanStack Router).
 *
 * Milestone A2 adds a `trusted` flag here — the explicit opt-in before an
 * artifact's own scripts are allowed to execute. A1 needs no such flag: its
 * renderer is inert by construction, because a `srcdoc` frame inherits the app's
 * `script-src 'self'`. See `docs/plan-artifact-preview.md` §4.2.
 */
export type ArtifactTarget = {
  kind: "attachment";
  /** Relay media URL, already passed through `rewriteRelayUrl`. */
  url: string;
  filename: string;
  artifact: ArtifactKind;
  size?: number;
};

export type ArtifactPanelTab = "preview" | "source";

type Snapshot = {
  target: ArtifactTarget | null;
  tab: ArtifactPanelTab;
};

const CLOSED: Snapshot = { target: null, tab: "preview" };

let snapshot: Snapshot = CLOSED;
const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

/**
 * Open (or replace) the previewed artifact. Re-opening the artifact already on
 * screen is a no-op, so a double click cannot reset the reader's tab choice or
 * churn the snapshot identity.
 */
export function openArtifact(target: ArtifactTarget) {
  if (snapshot.target?.url === target.url) return;
  publish({ target, tab: "preview" });
}

export function closeArtifact() {
  if (!snapshot.target) return;
  publish(CLOSED);
}

export function setArtifactTab(tab: ArtifactPanelTab) {
  if (snapshot.tab === tab) return;
  publish({ ...snapshot, tab });
}

export function useArtifactPanel() {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

export function resetArtifactPanelForTests() {
  snapshot = CLOSED;
}

export function getArtifactPanelSnapshotForTests() {
  return snapshot;
}
