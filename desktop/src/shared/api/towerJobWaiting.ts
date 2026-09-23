import type {
  PortfolioWaiting,
  WaitingReason,
} from "@/features/tower/domain/portfolio";
import type { RelayEvent } from "@/shared/api/types";
import { KIND_JOB_WAITING } from "@/shared/constants/kinds";
import { JOB_KINDS } from "./towerJobFold";

/**
 * The waiting reader for the "job at rest" projection (kind 43008).
 *
 * **This is the only place the UI's world learns the kind.** The reader lives
 * beside the fold, not inside it: a wait is a fact about a job, not a phase of
 * its lifecycle, so 43008 is not a member of `JOB_KINDS` and `STATE_BY_KIND` is
 * not touched — the lifecycle fold still decides state by kind, and this module
 * decides only "is this job at rest, why, and since when".
 *
 * **The deletion rule is the semantics of this reader:** a wait is the newest
 * 43008 of its job, and it is dropped when any lifecycle event of the same job
 * was published at or after it. Without that, a wait would stay glued to a job
 * that has since resumed, and the surface would say "at rest" about work that
 * moved — a lie in the opposite direction.
 */

/** Membership test for the six lifecycle kinds, which date a job's movement. */
const LIFECYCLE_KINDS = new Set<number>(JOB_KINDS);

/** The closed reason vocabulary, mirroring the CLI's `--reason` values. */
const WAITING_REASONS: ReadonlySet<string> = new Set<WaitingReason>([
  "ladder_exhausted",
  "capability_denied",
]);

/** One job's recorded wait, decoupled from the event that carried it. */
export interface JobWaiting extends PortfolioWaiting {
  jobId: string;
  /**
   * The role the waiting event named, or `null` when it named none. A wait for
   * a job with no role in the same read keeps its own row rather than borrowing
   * another job's name.
   */
  role: string | null;
}

export interface WaitingFoldResult {
  /** One entry per job with a surviving wait; the newest 43008 wins a collision. */
  waiting: JobWaiting[];
  /**
   * 43008 events dropped because they carried no usable `reason` (missing, or
   * outside the closed vocabulary). Declared so a malformed producer is visible
   * instead of silently swallowed; the surface never renders this as a number.
   */
  dropped: number;
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
 * Folds the waiting events of one read into at most one entry per job.
 *
 * Runs against the **same read** as the lifecycle fold: the lifecycle events
 * that delete a stale wait must arrive alongside it, which is why the portfolio
 * filter carries 43008 next to `JOB_KINDS`. Events that cannot be read — an
 * unknown kind, no `job`, no `reason`, a `reason` outside the vocabulary, a
 * malformed `created_at` — are dropped rather than guessed at.
 */
export function foldWaitingForJob(
  events: readonly RelayEvent[],
): WaitingFoldResult {
  // The newest lifecycle instant per job: what a wait has to outlive.
  const movedAt = new Map<string, number>();
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    if (!LIFECYCLE_KINDS.has(event.kind)) continue;
    const jobId = tagValue(event, "job");
    if (jobId === null) continue;
    const at = createdAtSeconds(event);
    if (at === null) continue;
    const current = movedAt.get(jobId);
    if (current === undefined || at > current) movedAt.set(jobId, at);
  }

  let dropped = 0;
  const newest = new Map<
    string,
    { at: number; reason: WaitingReason; role: string | null }
  >();
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    if (event.kind !== KIND_JOB_WAITING) continue;
    const jobId = tagValue(event, "job");
    const reason = tagValue(event, "reason");
    const at = createdAtSeconds(event);
    if (
      jobId === null ||
      at === null ||
      reason === null ||
      !WAITING_REASONS.has(reason)
    ) {
      dropped += 1;
      continue;
    }
    const current = newest.get(jobId);
    if (current === undefined || at > current.at) {
      newest.set(jobId, {
        at,
        reason: reason as WaitingReason,
        role: tagValue(event, "role"),
      });
    }
  }

  const waiting: JobWaiting[] = [];
  for (const [jobId, entry] of newest) {
    // The deletion rule: a job that moved at or after the wait is not at rest.
    // Equal instants give the movement the tiebreak — never affirm a wait that
    // cannot be told apart from a resumption.
    const moved = movedAt.get(jobId);
    if (moved !== undefined && moved >= entry.at) continue;
    waiting.push({
      jobId,
      reason: entry.reason,
      at: new Date(entry.at * 1000).toISOString(),
      role: entry.role,
    });
  }

  waiting.sort((a, b) => a.jobId.localeCompare(b.jobId));
  return { waiting, dropped };
}
