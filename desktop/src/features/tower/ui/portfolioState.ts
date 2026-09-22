import { TowerSourceError } from "@/features/tower/domain/TowerSource";
import type { PortfolioLine } from "@/features/tower/domain/portfolio";

/**
 * The section has one phase and a snapshot; the render is derived from the
 * pair. The decision table lives in {@link derivePortfolioView} and is the only
 * place the branches are chosen.
 *
 * | phase         | lines | render                                  |
 * |---------------|-------|-----------------------------------------|
 * | `loading`     | null  | section skeleton                        |
 * | `loading`     | data  | the list, not unmounted                 |
 * | `ready`       | `[]`  | empty state                             |
 * | `ready`       | N > 0 | the list                                |
 * | `unreachable` | null  | error state, no figures                 |
 * | `unreachable` | data  | stale banner + the previous list        |
 *
 * `ready` + `[]` and `unreachable` are distinct and not interchangeable: a
 * failed adapter read is not "zero lines", and an empty read is not a failure.
 */
export type TowerPhase = "loading" | "ready" | "unreachable";

export interface TowerFailure {
  /** The adapter's citable code, or `null` when it did not supply one. */
  code: string | null;
  message: string;
}

export interface TimedLinesView<T> {
  phase: TowerPhase;
  /** Last good read. `null` means there was never one — nothing to preserve. */
  lines: T[] | null;
  /** When `lines` was obtained. `null` when there is no snapshot. */
  lastSuccessAt: string | null;
  /** Present only in `unreachable`. */
  failure: TowerFailure | null;
  /** True during a background refetch over existing data (R2): no skeleton. */
  refreshing: boolean;
  retry: () => void;
}

/** The portfolio's row type is the only specialization of {@link TimedLinesView}. */
export type PortfolioView = TimedLinesView<PortfolioLine>;

/** The subset of a React Query result this derivation reads. */
export interface TimedLinesQuerySnapshot<T> {
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  data: T[] | undefined;
  dataUpdatedAt: number;
  error: unknown;
}

export type PortfolioQuerySnapshot = TimedLinesQuerySnapshot<PortfolioLine>;

function failureFrom(error: unknown): TowerFailure {
  if (error instanceof TowerSourceError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    // The adapter did not supply a code: say so rather than invent one.
    return { code: null, message: error.message };
  }
  return { code: null, message: "The telemetry source could not be read." };
}

export function deriveTimedLinesView<T>(
  snapshot: TimedLinesQuerySnapshot<T>,
  retry: () => void,
): TimedLinesView<T> {
  const hasSnapshot = snapshot.data !== undefined;
  const phase: TowerPhase = snapshot.isPending
    ? "loading"
    : snapshot.isError
      ? "unreachable"
      : "ready";

  return {
    phase,
    lines: snapshot.data ?? null,
    lastSuccessAt:
      hasSnapshot && snapshot.dataUpdatedAt > 0
        ? new Date(snapshot.dataUpdatedAt).toISOString()
        : null,
    failure: snapshot.isError ? failureFrom(snapshot.error) : null,
    refreshing: snapshot.isFetching && !snapshot.isPending && !snapshot.isError,
    retry,
  };
}

/** The portfolio's specialization of the shared decision table. */
export function derivePortfolioView(
  snapshot: PortfolioQuerySnapshot,
  retry: () => void,
): PortfolioView {
  return deriveTimedLinesView(snapshot, retry);
}

/**
 * Failures rise. Lines that need the operator come first, then most recent
 * first; `null` recency sorts last. The tiebreak is the source index so a
 * refetch that does not change the data does not reorder rows under the focus.
 */
export function orderPortfolioLines(lines: PortfolioLine[]): PortfolioLine[] {
  const recencyValue = (line: PortfolioLine): number => {
    if (line.recency.lastSpanAt === null) return Number.NEGATIVE_INFINITY;
    const parsed = Date.parse(line.recency.lastSpanAt);
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  };

  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => {
      const aNeedsAttention = a.line.blocked.count > 0 ? 0 : 1;
      const bNeedsAttention = b.line.blocked.count > 0 ? 0 : 1;
      if (aNeedsAttention !== bNeedsAttention) {
        return aNeedsAttention - bNeedsAttention;
      }
      const delta = recencyValue(b.line) - recencyValue(a.line);
      if (delta !== 0) return delta;
      return a.index - b.index;
    })
    .map((entry) => entry.line);
}

/** Lines the operator should look at, in list order. */
export function linesNeedingAttention(lines: PortfolioLine[]): PortfolioLine[] {
  return lines.filter((line) => line.blocked.count > 0);
}
