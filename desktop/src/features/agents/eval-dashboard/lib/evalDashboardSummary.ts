/**
 * Pure header-summary math for the eval dashboard (R5).
 *
 * Kept separate from the view so the "cabecera coincide con el recuento
 * reverificado" criterion (I2) can be pinned with a plain data-in/data-out
 * test, with no DOM or Tauri bridge involved.
 */

import type { AgentEvalSummary } from "../../skills/types";

export type EvalDashboardSummaryTotals = {
  /** Every folder under `evals_dir()` — the carpeta manda count (R1). */
  totalAgents: number;
  /** Sum of `cases.length` across every folder. */
  totalCases: number;
  /** Folders whose latest bulletin has `tendencia: baja` (R5's definition). */
  regressions: number;
};

export function computeEvalDashboardSummary(
  summaries: AgentEvalSummary[],
): EvalDashboardSummaryTotals {
  let totalCases = 0;
  let regressions = 0;
  for (const summary of summaries) {
    totalCases += summary.cases.length;
    if (summary.bulletin?.trend === "baja") regressions += 1;
  }
  return {
    totalAgents: summaries.length,
    totalCases,
    regressions,
  };
}
