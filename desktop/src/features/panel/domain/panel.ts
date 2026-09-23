import type {
  HandoverParentOutcome,
  HandoverRow,
} from "@/features/tower/domain/handover";
import type {
  PortfolioLine,
  WaitingReason,
  WorkState,
} from "@/features/tower/domain/portfolio";

/**
 * El panel — the workforce read model.
 *
 * One row per encargo (job), built by joining the two reads the panel already
 * has through the same {@link TowerSource}: the portfolio (lifecycle state,
 * recency, recorded wait) and the handoff edges (the parent that delivered to
 * this job, and where the work was discussed). Nothing here names a Nostr kind;
 * the projection lives behind the port.
 *
 * The row is the unit the six cells render from. Every cell that has no data is
 * `null` in this model — never `0`, never an empty string — so a surface can
 * tell "the source said nothing" apart from "the source said nothing here".
 */
export interface PanelRow {
  /** The job id, as the portfolio's `job` tag carries it. */
  jobId: string;
  /** Cell **Quién**: the role named for this job, or the fold's placeholder. */
  role: string;
  /** Cell **En qué**, first half: the lifecycle state the producer reported. */
  workState: WorkState | null;
  /** Cell **En qué**, second half: the producer's own line, never the interior. */
  task: string | null;
  /** Cell **Instante**: the last readable event instant, or `null`. */
  lastEventAt: string | null;
  /**
   * Cell **Espera**: the recorded wait, or `null` for "sin señal". Never `0`,
   * and never a claim that nothing waits — the producer is best-effort.
   */
  waiting: { reason: WaitingReason; at: string } | null;
  /**
   * Cells **De qué encargo viene** + **Resultado del padre**: the parent that
   * delivered to this job, or `null` when no edge was read for it.
   */
  parent: { jobId: string; outcome: HandoverParentOutcome } | null;
  /**
   * Cell **Hilo**: the channel the work was discussed in, or `null`. The
   * `eventId` is `null` when the producer carried a channel but no thread.
   */
  thread: { channel: string; eventId: string | null } | null;
}

/**
 * Joins the portfolio lines with the handoff edges into panel rows.
 *
 * The join key is the child job of an edge: an edge points **at** the job it
 * delivered to, so the row whose `jobId` is the child owns that parent. When a
 * job has several edges (a republication, or two parents), the newest readable
 * `transferredAt` wins; ties keep the first, so a refetch that changes nothing
 * does not reorder the cell.
 */
export function buildPanelRows(
  lines: readonly PortfolioLine[],
  handovers: readonly HandoverRow[],
): PanelRow[] {
  const newestEdgeByChild = new Map<string, HandoverRow>();
  for (const edge of handovers) {
    const child = edge.child.jobId;
    const current = newestEdgeByChild.get(child);
    if (
      current === undefined ||
      (edge.transferredAt ?? "") > (current.transferredAt ?? "")
    ) {
      newestEdgeByChild.set(child, edge);
    }
  }

  const rows = lines.map((line): PanelRow => {
    const edge = newestEdgeByChild.get(line.project.id);
    return {
      jobId: line.project.id,
      role: line.project.name,
      workState: line.work?.state ?? null,
      task: line.work?.summary ?? null,
      lastEventAt: line.recency.lastSpanAt,
      waiting: line.waiting,
      parent:
        edge === undefined
          ? null
          : { jobId: edge.sender.jobId, outcome: edge.parentOutcome },
      thread: edge?.thread ?? null,
    };
  });

  return orderPanelRows(rows);
}

/** Instant of a row for ordering: `null` sorts last, never as "long ago"=0. */
function instantValue(at: string | null): number {
  if (at === null) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(at);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Recorded waits first, then most recent first; `null` instants sort last. The
 * order is the panel's whole job — order the operator's attention — so a row
 * that has a recorded wait is never sorted below one that has none.
 */
export function orderPanelRows(rows: readonly PanelRow[]): PanelRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const aWaiting = a.row.waiting === null ? 1 : 0;
      const bWaiting = b.row.waiting === null ? 1 : 0;
      if (aWaiting !== bWaiting) return aWaiting - bWaiting;
      const delta =
        instantValue(b.row.lastEventAt) - instantValue(a.row.lastEventAt);
      if (delta !== 0) return delta;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}
