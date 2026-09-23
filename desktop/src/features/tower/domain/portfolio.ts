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

/**
 * The lifecycle state of one unit of agent work, as reported by the source.
 *
 * The producer states it; this model never derives it from prose. `requested`
 * means asked-for and not yet picked up — it is not "stalled", and nothing here
 * infers stalling.
 */
export type WorkState =
  | "requested"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

export interface PortfolioWork {
  state: WorkState;
  /** The source's own human-readable line, or `null` when it said nothing. */
  summary: string | null;
}

/** One supervisory line of the portfolio. */
export interface PortfolioLine {
  project: PortfolioProject;
  recency: PortfolioRecency;
  blocked: PortfolioBlocked;
  /**
   * The unit of work this line stands for. `null` means the line is not a run
   * — the source could name the subject but not any work under it.
   */
  work: PortfolioWork | null;
  /**
   * `null` means not legible — the UI renders "not available", never `0`.
   */
  cost: PortfolioCost | null;
  /**
   * The recorded wait: the job is at rest and the next move is the operator's.
   *
   * `null` is **"sin señal"**, never "no wait": the producer that records this
   * (`KIND_JOB_WAITING`) is best-effort, so absence of the event is not evidence
   * that nothing waits. The surface says so in words — and never renders a `0`.
   */
  waiting: PortfolioWaiting | null;
}

/**
 * Why a job is recorded as at rest. A closed vocabulary, carried by the
 * producer's `reason` tag; the surface names the reason rather than guessing a
 * human cause.
 *
 * `ladder_exhausted` — the automated ladder tried and gave up.
 * `capability_denied` — the job needs a capability the agent does not have.
 */
export type WaitingReason = "ladder_exhausted" | "capability_denied";

/** The recorded wait and the instant it was recorded. */
export interface PortfolioWaiting {
  reason: WaitingReason;
  /** ISO instant of the waiting event. */
  at: string;
}
