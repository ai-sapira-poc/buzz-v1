/**
 * Which top-level section `/agents` shows — the library (default) or the
 * eval dashboard (I5, `PLANS/PLAN_SUITE_EVALS_UI_RENDIMIENTO.md`).
 *
 * Backed by a URL search param so the dashboard is reachable both by
 * clicking the tab and by a direct link, same pattern as
 * `workflowEditorPane.ts`'s `view=create`.
 */
export type AgentsViewMode = "agents" | "evals";

export function parseAgentsViewMode(value: unknown): AgentsViewMode {
  return value === "evals" ? "evals" : "agents";
}

export function serializeAgentsViewMode(
  mode: AgentsViewMode,
): string | undefined {
  return mode === "evals" ? "evals" : undefined;
}
