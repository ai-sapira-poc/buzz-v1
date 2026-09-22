import type { HandoverRow } from "@/features/tower/domain/handover";
import {
  deriveTimedLinesView,
  type TimedLinesQuerySnapshot,
  type TimedLinesView,
} from "./portfolioState";

/**
 * The handoff section reuses the portfolio's decision table unchanged: a failed
 * read is never "zero rows", and an empty read is never a failure. Only the row
 * type differs, so the branch logic lives in one place.
 */
export type HandoverQuerySnapshot = TimedLinesQuerySnapshot<HandoverRow>;
export type HandoverView = TimedLinesView<HandoverRow>;

export function deriveHandoverView(
  snapshot: HandoverQuerySnapshot,
  retry: () => void,
): HandoverView {
  return deriveTimedLinesView(snapshot, retry);
}
