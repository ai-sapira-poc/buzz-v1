import type { HandoverRow } from "@/features/tower/domain/handover";
import type {
  PortfolioLine,
  PortfolioWaiting,
} from "@/features/tower/domain/portfolio";
import {
  TowerSourceError,
  type TowerSource,
} from "@/features/tower/domain/TowerSource";
import { relayClient } from "@/shared/api/relayClient";
import { getIdentity } from "@/shared/api/tauriIdentity";
import type { RelaySubscriptionFilter } from "@/shared/api/relayClientShared";
import type { RelayEvent } from "@/shared/api/types";
import { KIND_JOB_WAITING } from "@/shared/constants/kinds";
import { buildHandoffEventFilter, foldHandoffEdges } from "./towerHandoffEdges";
import { foldJobEventsToPortfolio, JOB_KINDS } from "./towerJobFold";
import { foldWaitingForJob, type JobWaiting } from "./towerJobWaiting";

/**
 * Buzz adapter for the {@link TowerSource} port.
 *
 * Reads the job lifecycle projection (kinds 43001–43006) scoped to the owner's
 * `p` tag — the same scoping the activity feed uses — and folds each job's
 * events into one portfolio line. The kind carries the state; the `job` tag is
 * the identity; the `role` tag names the agent.
 * What this projection does not carry is reported as absent, not as zero:
 * `cost = null`, because these events hold no token accounting. The UI renders
 * that as "not available".
 *
 * Nothing above this file knows a kind exists.
 */

/** Bounded per read: Tower is a supervisory glance, not an archive. */
export const TOWER_JOB_EVENT_LIMIT = 500;

export type FetchJobEvents = (ownerPubkey: string) => Promise<RelayEvent[]>;

/** Same shape as {@link FetchJobEvents}, over the handoff read. */
export type FetchHandoffEvents = (ownerPubkey: string) => Promise<RelayEvent[]>;

/**
 * The filter the production read actually sends. `kinds` is explicit and
 * required — a filter without it is refused by the relay's p-gate with a 403 —
 * and `#p` is what makes this the owner's portfolio rather than the relay's.
 */
export function buildJobEventFilter(
  ownerPubkey: string,
): RelaySubscriptionFilter {
  return {
    // The wait projection (`KIND_JOB_WAITING`) rides the same read as the
    // lifecycle kinds: a stale wait is only deletable when the lifecycle event
    // that resumed the job arrives alongside it. It is added to the filter,
    // not to `JOB_KINDS` — the state fold must not learn it as a state.
    kinds: [...JOB_KINDS, KIND_JOB_WAITING],
    "#p": [ownerPubkey],
    limit: TOWER_JOB_EVENT_LIMIT,
  };
}

async function fetchJobEventsFromRelay(
  ownerPubkey: string,
): Promise<RelayEvent[]> {
  return relayClient.fetchEvents(buildJobEventFilter(ownerPubkey));
}

async function fetchHandoffEventsFromRelay(
  ownerPubkey: string,
): Promise<RelayEvent[]> {
  return relayClient.fetchEvents(buildHandoffEventFilter(ownerPubkey));
}

/**
 * Attaches the recorded wait to the line of the job it names and, for a wait
 * whose job published no lifecycle event in this read, adds a line of its own.
 *
 * That last branch is deliberate: it is born of a failure that already happens
 * — a publication that dies on a relay error leaves the wait with no lifecycle
 * event around it — and dropping it silently would lose exactly what the panel
 * went to read. The added line says `work: null`: the subject is named, no work
 * under it was legible.
 */
function mergeWaitingIntoPortfolio(
  events: readonly RelayEvent[],
): PortfolioLine[] {
  const lines = foldJobEventsToPortfolio(events);
  const { waiting } = foldWaitingForJob(events);
  const byJob = new Map(waiting.map((entry) => [entry.jobId, entry]));
  const known = new Set(lines.map((line) => line.project.id));

  const merged = lines.map((line) => {
    const entry = byJob.get(line.project.id);
    return entry === undefined ? line : { ...line, waiting: waitingOf(entry) };
  });
  for (const entry of waiting) {
    if (known.has(entry.jobId)) continue;
    merged.push(orphanWaitingLine(entry));
  }
  return merged;
}

function waitingOf(entry: JobWaiting): PortfolioWaiting {
  return { reason: entry.reason, at: entry.at };
}

function orphanWaitingLine(entry: JobWaiting): PortfolioLine {
  return {
    project: { id: entry.jobId, name: entry.role ?? "Unnamed agent" },
    recency: { lastSpanAt: entry.at },
    // No lifecycle event was read for this job, so no state was reported. The
    // blocked cell is not claimed (`basis: null`): a job never observed must
    // not read as "0 observed" on the Tower row.
    blocked: { count: 0, basis: null },
    cost: null,
    work: null,
    waiting: waitingOf(entry),
  };
}

/**
 * @param fetchJobEvents injected so the adapter is testable against fixed
 * events without a relay; production callers pass nothing.
 * @param resolveOwnerPubkey injected for the same reason.
 * @param fetchHandoffEvents injected for the same reason; it reads the edge
 * projection, which carries the lifecycle kinds too (the parent's outcome is
 * joined from the same read).
 */
export function createTowerBuzzSource(
  fetchJobEvents: FetchJobEvents = fetchJobEventsFromRelay,
  resolveOwnerPubkey: () => Promise<string> = () =>
    getIdentity().then((identity) => identity.pubkey),
  fetchHandoffEvents: FetchHandoffEvents = fetchHandoffEventsFromRelay,
): TowerSource {
  async function resolveOwner(): Promise<string> {
    const ownerPubkey = await resolveOwnerPubkey();
    if (typeof ownerPubkey !== "string" || ownerPubkey.length === 0) {
      // No owner means the query cannot be scoped. That is a failed read, not
      // an owner with no work.
      throw new Error("No owner identity available to scope the read.");
    }
    return ownerPubkey;
  }

  return {
    async getPortfolio(): Promise<PortfolioLine[]> {
      try {
        const ownerPubkey = await resolveOwner();
        const events = await fetchJobEvents(ownerPubkey);
        return mergeWaitingIntoPortfolio(events ?? []);
      } catch (cause) {
        // Fail closed: a read failure must reject so the section renders the
        // error branch. Resolving to `[]` here would paint "no work yet" over
        // a dead source.
        throw new TowerSourceError(
          "adapter_unavailable",
          "Could not read agent work from the relay.",
          { cause },
        );
      }
    },

    async getHandovers(): Promise<HandoverRow[]> {
      try {
        const ownerPubkey = await resolveOwner();
        const events = await fetchHandoffEvents(ownerPubkey);
        return foldHandoffEdges(events ?? []);
      } catch (cause) {
        // Same rule as the portfolio: an empty handoff list is a successful
        // read, so a failure must reject rather than borrow that meaning.
        throw new TowerSourceError(
          "adapter_unavailable",
          "Could not read agent handoffs from the relay.",
          { cause },
        );
      }
    },
  };
}

export const towerBuzzSource: TowerSource = createTowerBuzzSource();
