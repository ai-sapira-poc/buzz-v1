import type { HandoverRow } from "@/features/tower/domain/handover";
import type { PortfolioLine } from "@/features/tower/domain/portfolio";
import {
  TowerSourceError,
  type TowerSource,
} from "@/features/tower/domain/TowerSource";
import { relayClient } from "@/shared/api/relayClient";
import { getIdentity } from "@/shared/api/tauriIdentity";
import type { RelaySubscriptionFilter } from "@/shared/api/relayClientShared";
import type { RelayEvent } from "@/shared/api/types";
import { buildHandoffEventFilter, foldHandoffEdges } from "./towerHandoffEdges";
import { foldJobEventsToPortfolio, JOB_KINDS } from "./towerJobFold";

/**
 * Buzz adapter for the {@link TowerSource} port.
 *
 * Reads the job lifecycle projection (kinds 43001–43006) scoped to the owner's
 * `p` tag — the same scoping the activity feed uses — and folds each job's
 * events into one portfolio line. The kind carries the state; the `job` tag is
 * the identity; the `role` tag names the agent.
 *
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
    kinds: JOB_KINDS,
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
        return foldJobEventsToPortfolio(events ?? []);
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
