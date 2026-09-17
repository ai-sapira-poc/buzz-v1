/**
 * Tower Control — neutral portfolio model.
 *
 * Field names follow the OpenTelemetry semantic conventions the team fixed
 * (`gen_ai.*`, `mcp.*`) so a future non-Buzz adapter maps by identity rather
 * than by translation. Nothing here names a Nostr kind: the UI and this model
 * are transport-agnostic, and the Buzz projection lives behind the
 * {@link TowerSource} port.
 *
 * Source of truth is the OTel span. `run.id = trace_id`: there is no
 * correspondence table.
 */

/**
 * How a `blocked` count is known.
 *
 * `observed` — the adapter carried the evidence (a span or event that says so).
 * `inferred` — the adapter derived it; the UI must label it as inference.
 * `null`     — no basis is available, so the UI must not claim "blocked".
 *
 * Today no mechanical producer emits `run.status = blocked` on the turn span,
 * so adapters are expected to return `null` and the UI renders recency instead
 * of fabricating a detection.
 */
export type BlockedBasis = "observed" | "inferred";

export interface PortfolioProject {
  id: string;
  name: string;
}

export interface PortfolioRecency {
  /** Last readable span for this line. `null` means no span was readable — not "idle". */
  lastSpanAt: string | null;
}

export interface PortfolioBlocked {
  count: number;
  basis: BlockedBasis | null;
}

/**
 * Owner-scoped cost. The coverage travels with the aggregate: a total that
 * silently sums only the readable turns is a wrong number presented as a right
 * one, so the UI never renders a bare total.
 */
export interface PortfolioCost {
  inputTokens: number;
  outputTokens: number;
  coverage: { observedAgents: number; totalAgents: number };
}

/** One supervisory line of the portfolio. */
export interface PortfolioLine {
  project: PortfolioProject;
  recency: PortfolioRecency;
  blocked: PortfolioBlocked;
  /**
   * `null` means not legible — the UI renders "not available", never `0`.
   */
  cost: PortfolioCost | null;
}
