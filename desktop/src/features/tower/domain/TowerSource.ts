import type { HandoverRow } from "./handover";
import type { PortfolioLine } from "./portfolio";

/**
 * The portability boundary: everything the Tower UI knows about the world
 * passes through this interface. Moving off Buzz means writing a new adapter,
 * not touching a screen.
 *
 * The contract that makes the state machine honest: **a failure must reject,
 * never resolve to `[]`.** An empty array is a successful read that reports
 * "no lines"; collapsing a failure into `[]` would render "nothing here yet"
 * over a dead source.
 */
export interface TowerSource {
  getPortfolio(): Promise<PortfolioLine[]>;
  /**
   * The handoff edges (parent job → child job), one row per edge. Fails closed
   * exactly like {@link TowerSource.getPortfolio}: a read failure rejects, it
   * never resolves to `[]`, so a dead source cannot render as "no handoffs".
   */
  getHandovers(): Promise<HandoverRow[]>;
}

/**
 * Citable failure codes the UI may render. Kept small and explicit so a banner
 * can quote the code the adapter actually produced instead of inventing one.
 */
export type TowerSourceFailureCode = "adapter_unavailable";

export class TowerSourceError extends Error {
  readonly code: TowerSourceFailureCode;

  constructor(
    code: TowerSourceFailureCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "TowerSourceError";
    this.code = code;
  }
}
