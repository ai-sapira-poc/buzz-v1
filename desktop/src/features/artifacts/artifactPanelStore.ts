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
 * `trusted` is the explicit opt-in gate: an artifact's own scripts never run
 * until the reader asks for it. Until then the panel shows the inert `srcdoc`
 * render, which cannot execute script because it inherits the app's
 * `script-src 'self'`. See `docs/plan-artifact-preview.md` §4.2.
 */
export type ArtifactTarget =
  | {
      kind: "attachment";
      /** Relay media URL, already passed through `rewriteRelayUrl`. */
      url: string;
      filename: string;
      artifact: ArtifactKind;
      size?: number;
    }
  | {
      /** A live dev server announced by an agent — Phase B. */
      kind: "devServer";
      /** Loopback URL, validated by `parseDevPreviewAnnouncements`. */
      url: string;
      port: number;
    };

/** Panel title for either target kind. */
export function artifactTargetLabel(target: ArtifactTarget): string {
  return target.kind === "attachment"
    ? target.filename
    : `localhost:${target.port}`;
}

export type ArtifactPanelTab = "preview" | "source";

type Snapshot = {
  target: ArtifactTarget | null;
  tab: ArtifactPanelTab;
  /** Set only by an explicit user action; reset whenever the target changes. */
  trusted: boolean;
};

const CLOSED: Snapshot = { target: null, tab: "preview", trusted: false };

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
  publish({ target, tab: "preview", trusted: false });
}

/**
 * Open a live dev-server preview. Separate entry point from `openArtifact` so
 * the two call sites read differently at a glance — one frames bytes the relay
 * already vetted, the other frames whatever is listening on a local port.
 */
export function openDevPreview(
  target: Extract<ArtifactTarget, { kind: "devServer" }>,
) {
  openArtifact(target);
}

export function closeArtifact() {
  if (!snapshot.target) return;
  publish(CLOSED);
}

export function setArtifactTab(tab: ArtifactPanelTab) {
  if (snapshot.tab === tab) return;
  publish({ ...snapshot, tab });
}

/**
 * Opt in to running the artifact's scripts. Deliberately one-way: there is no
 * `setTrusted(false)`, because trust is scoped to one target and is discarded
 * wholesale when the panel closes or shows a different file.
 */
export function trustArtifact() {
  if (snapshot.trusted || !snapshot.target) return;
  publish({ ...snapshot, trusted: true });
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
