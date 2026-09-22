import type {
  HandoverParentOutcome,
  HandoverRow,
} from "@/features/tower/domain/handover";
import type { RelaySubscriptionFilter } from "@/shared/api/relayClientShared";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_JOB_CANCEL,
  KIND_JOB_ERROR,
  KIND_JOB_HANDOFF,
  KIND_JOB_RESULT,
} from "@/shared/constants/kinds";
import { JOB_KINDS } from "./towerJobFold";

/** Membership test for the six lifecycle kinds, which name a job's role. */
const LIFECYCLE_KINDS = new Set<number>(JOB_KINDS);

/**
 * The edge reader for the handoff projection (kind 43007).
 *
 * **This is the only place the UI's world learns the kind.** The reader lives
 * beside the fold, not inside it: a handoff is an edge, so it is not a member of
 * `JOB_KINDS` and `STATE_BY_KIND` is not touched — the fold still decides state
 * by kind, and this module decides only "who handed off to whom".
 *
 * The parent's terminal outcome is joined from the lifecycle events of the same
 * read: an edge is only decidable when the parent's end is also legible. When it
 * is not, the row says `unknown` in words rather than guessing.
 */

/** Terminal lifecycle kinds and the outcome each carries. */
const OUTCOME_BY_KIND = new Map<number, HandoverParentOutcome>([
  [KIND_JOB_RESULT, "done"],
  [KIND_JOB_ERROR, "failed"],
  [KIND_JOB_CANCEL, "cancelled"],
]);

/** Bounded per read, matching the portfolio read: a glance, not an archive. */
export const TOWER_HANDOFF_EVENT_LIMIT = 500;

/**
 * The filter the production read sends. It includes the lifecycle kinds as well
 * as the handoff kind: the parent's terminal event and the edge that points at
 * it must arrive in the same read, or every outcome would be `unknown`.
 */
export function buildHandoffEventFilter(
  ownerPubkey: string,
): RelaySubscriptionFilter {
  return {
    kinds: [...JOB_KINDS, KIND_JOB_HANDOFF],
    "#p": [ownerPubkey],
    limit: TOWER_HANDOFF_EVENT_LIMIT,
  };
}

function tagValue(event: RelayEvent, name: string): string | null {
  const tags = Array.isArray(event.tags) ? event.tags : [];
  for (const tag of tags) {
    if (Array.isArray(tag) && tag[0] === name && typeof tag[1] === "string") {
      const value = tag[1].trim();
      if (value.length > 0) return value;
    }
  }
  return null;
}

function createdAtSeconds(event: RelayEvent): number | null {
  return typeof event.created_at === "number" &&
    Number.isFinite(event.created_at)
    ? event.created_at
    : null;
}

/**
 * The role each job named on its own lifecycle events.
 *
 * The handoff event carries only the **emitter's** role, so the receiver's role
 * is joined here from the child's own events — the same read carries them. A
 * job whose role was never published has no entry, and the row says so rather
 * than borrowing the emitter's name.
 */
function rolesByJob(events: readonly RelayEvent[]): Map<string, string> {
  const roles = new Map<string, string>();
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    if (!LIFECYCLE_KINDS.has(event.kind)) continue;
    const jobId = tagValue(event, "job");
    const role = tagValue(event, "role");
    if (jobId === null || role === null) continue;
    // First name wins: a later event of the same job that omits the role must
    // not erase the one already known.
    if (!roles.has(jobId)) roles.set(jobId, role);
  }
  return roles;
}

/** Newest edge wins a collision; equal or unreadable instants keep the first. */
function supersedesEdge(candidate: HandoverRow, current: HandoverRow): boolean {
  return (candidate.transferredAt ?? "") > (current.transferredAt ?? "");
}

/**
 * Folds the handoff events of one read into one row per edge.
 *
 * One row per **child** (fan-out 1:N): the producer emits one 43007 per edge, so
 * the row count is the edge count, never a row per parent. The fold is keyed by
 * the edge identity, not by the event: a republication of the same
 * (parent, child) edge updates its row instead of adding a second one —
 * otherwise a retried publish would draw the same child twice, with the same
 * key. Malformed events — no `job`, no `child`, an unreadable timestamp — are
 * dropped rather than guessed at, so one unreadable event cannot blank the
 * section.
 */
export function foldHandoffEdges(events: readonly RelayEvent[]): HandoverRow[] {
  const newestOutcome = new Map<
    string,
    { at: number; outcome: HandoverParentOutcome }
  >();
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const outcome = OUTCOME_BY_KIND.get(event.kind);
    if (outcome === undefined) continue;
    const jobId = tagValue(event, "job");
    if (jobId === null) continue;
    const at = createdAtSeconds(event);
    if (at === null) continue;
    const current = newestOutcome.get(jobId);
    if (current === undefined || at >= current.at) {
      newestOutcome.set(jobId, { at, outcome });
    }
  }

  const childRoles = rolesByJob(events);
  const rows = new Map<string, HandoverRow>();
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    if (event.kind !== KIND_JOB_HANDOFF) continue;
    const parentJobId = tagValue(event, "job");
    const childJobId = tagValue(event, "child");
    // An edge with one end missing is not an edge; never draw a half row.
    if (parentJobId === null || childJobId === null) continue;
    const at = createdAtSeconds(event);
    const channel = tagValue(event, "h");
    const id = `${parentJobId}->${childJobId}`;
    const row: HandoverRow = {
      id,
      // The sender is the emitter of the handoff action: the parent job and the
      // agent the producer named for it — never the child's role.
      sender: { jobId: parentJobId, name: tagValue(event, "role") },
      child: {
        jobId: childJobId,
        name: childRoles.get(childJobId) ?? null,
      },
      parentOutcome: newestOutcome.get(parentJobId)?.outcome ?? "unknown",
      transferredAt: at === null ? null : new Date(at * 1000).toISOString(),
      // The producer carries the channel but not the thread id, so the anchor
      // is absent; the surface says the thread could not be opened.
      thread: channel === null ? null : { channel, eventId: null },
    };
    const previous = rows.get(id);
    if (previous === undefined || supersedesEdge(row, previous)) {
      rows.set(id, row);
    }
  }

  return [...rows.values()].sort((a, b) => {
    const left = a.transferredAt ?? "";
    const right = b.transferredAt ?? "";
    if (left === right) return a.id.localeCompare(b.id);
    return right.localeCompare(left);
  });
}
