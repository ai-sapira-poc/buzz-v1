import type {
  PortfolioLine,
  WorkState,
} from "@/features/tower/domain/portfolio";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_JOB_ACCEPTED,
  KIND_JOB_CANCEL,
  KIND_JOB_ERROR,
  KIND_JOB_PROGRESS,
  KIND_JOB_REQUEST,
  KIND_JOB_RESULT,
} from "@/shared/constants/kinds";

/**
 * The Nostr projection of agent work, folded into the neutral portfolio model.
 *
 * **The kind is the state.** Content is a human-readable line the producer
 * already wrote in business language; it is carried through as a summary and
 * never parsed to decide anything. Adding a state means adding a kind here, not
 * a regex.
 */
export const JOB_KINDS: number[] = [
  KIND_JOB_REQUEST,
  KIND_JOB_ACCEPTED,
  KIND_JOB_PROGRESS,
  KIND_JOB_RESULT,
  KIND_JOB_CANCEL,
  KIND_JOB_ERROR,
];

const STATE_BY_KIND = new Map<number, WorkState>([
  [KIND_JOB_REQUEST, "requested"],
  [KIND_JOB_ACCEPTED, "running"],
  [KIND_JOB_PROGRESS, "running"],
  [KIND_JOB_RESULT, "done"],
  [KIND_JOB_CANCEL, "cancelled"],
  [KIND_JOB_ERROR, "failed"],
]);

/**
 * Tiebreak only. Two events of one job sharing a second are ordered by how far
 * along the lifecycle they are, so a result that lands in the same second as
 * its acceptance still wins.
 */
const STATE_PROGRESSION: Record<WorkState, number> = {
  requested: 0,
  running: 1,
  done: 2,
  cancelled: 3,
  failed: 4,
};

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

type JobAccumulator = {
  jobId: string;
  role: string | null;
  state: WorkState;
  summary: string | null;
  newestAt: number;
  rank: number;
  firstSeenIndex: number;
};

/** Newest wins; equal timestamps fall back to lifecycle progression. */
function supersedes(
  candidate: { at: number; rank: number },
  current: { newestAt: number; rank: number },
): boolean {
  if (candidate.at !== current.newestAt) return candidate.at > current.newestAt;
  return candidate.rank > current.rank;
}

function lineFrom(job: JobAccumulator): PortfolioLine {
  const failed = job.state === "failed";
  return {
    project: {
      id: job.jobId,
      // A job whose producer named no role is still real work; say the name is
      // missing rather than drop the line or invent an agent.
      name: job.role ?? "Unnamed agent",
    },
    recency: { lastSpanAt: new Date(job.newestAt * 1000).toISOString() },
    // The source reported this job's state explicitly, so the basis is
    // observed — including the observation that it is not blocked.
    blocked: { count: failed ? 1 : 0, basis: "observed" },
    // These events carry no token accounting. Absent, never a measured zero.
    cost: null,
    work: { state: job.state, summary: job.summary },
  };
}

/**
 * Folds every event of a job into one line: the `job` tag is the identity, the
 * newest kind is the state, the `role` tag names the agent.
 *
 * Events that cannot be correlated — no `job` tag, an unknown kind, a
 * malformed `created_at` — are dropped rather than guessed at or thrown on. A
 * relay that returns one unreadable event must not blank the whole section.
 */
export function foldJobEventsToPortfolio(
  events: readonly RelayEvent[],
): PortfolioLine[] {
  const jobs = new Map<string, JobAccumulator>();

  events.forEach((event, index) => {
    if (!event || typeof event !== "object") return;
    const state = STATE_BY_KIND.get(event.kind);
    if (state === undefined) return;
    const jobId = tagValue(event, "job");
    if (jobId === null) return;
    const at = event.created_at;
    if (!Number.isFinite(at)) return;

    const role = tagValue(event, "role");
    const content =
      typeof event.content === "string" ? event.content.trim() : "";
    const summary = content.length > 0 ? content : null;
    const rank = STATE_PROGRESSION[state];
    const current = jobs.get(jobId);

    if (current === undefined) {
      jobs.set(jobId, {
        jobId,
        role,
        state,
        summary,
        newestAt: at,
        rank,
        firstSeenIndex: index,
      });
      return;
    }

    // A role named on any event of the job names the job; later events that
    // omit the tag must not erase it.
    if (current.role === null && role !== null) current.role = role;
    if (!supersedes({ at, rank }, current)) return;
    current.state = state;
    current.summary = summary;
    current.newestAt = at;
    current.rank = rank;
  });

  return [...jobs.values()]
    .sort((a, b) => a.firstSeenIndex - b.firstSeenIndex)
    .map(lineFrom);
}
