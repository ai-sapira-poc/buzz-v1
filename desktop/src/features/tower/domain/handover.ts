/**
 * Tower Control — the handoff ("el relevo") read model.
 *
 * A handoff is an **edge** between two jobs, not a state of one: the parent
 * delivered its conclusion to the child. It is kept out of the portfolio state
 * machine on purpose — folding it into `WorkState` would let a reader treat
 * "delivered" as a lifecycle state, and the fold's contract is "the kind IS the
 * state".
 *
 * Nothing here names a Nostr kind: the projection lives behind the
 * {@link TowerSource} port. Every field that the producer did not carry is
 * `null`, and the surfaces render an explicit "not carried" line rather than a
 * blank or a fabricated value.
 */

/**
 * How the parent job ended, as reported by the parent's own terminal event.
 *
 * `unknown` is not "cancelled" and not "did not hand off": it means no terminal
 * event for the parent was readable, so the operator cannot decide whether the
 * child rests on the parent's conclusion. The row says so in words.
 */
export type HandoverParentOutcome = "done" | "failed" | "cancelled" | "unknown";

/** One end of a handoff. `name` is the source's own label, or `null`. */
export interface HandoverActor {
  jobId: string;
  name: string | null;
}

/**
 * Where the work was discussed. `eventId` is `null` when the producer carried a
 * channel but not the thread: the surface then says the thread could not be
 * opened rather than opening a new one.
 */
export interface HandoverThread {
  channel: string;
  eventId: string | null;
}

/** One supervisory row: exactly one child per row (fan-out is 1:N). */
export interface HandoverRow {
  /** Stable key: the edge identity, `parent->child`. */
  id: string;
  /** The parent that delivered, and the agent the source named for it. */
  sender: HandoverActor;
  /** The child the edge points at (the receiving job). */
  child: HandoverActor;
  /** The parent's terminal outcome, or `unknown` when none was readable. */
  parentOutcome: HandoverParentOutcome;
  /** ISO instant of the handoff publication, or `null` when not carried. */
  transferredAt: string | null;
  /** `null` means no channel was carried — "sin hilo", not "no discussion". */
  thread: HandoverThread | null;
}
