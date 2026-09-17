import { fetchProjects } from "@/features/projects/projectFetch";
import type { Project } from "@/features/projects/projectModels";
import type { PortfolioLine } from "@/features/tower/domain/portfolio";
import {
  TowerSourceError,
  type TowerSource,
} from "@/features/tower/domain/TowerSource";

/**
 * Buzz adapter for the {@link TowerSource} port.
 *
 * The source of truth for Tower Control is the OpenTelemetry span, and the
 * Nostr projection of tower runs (kinds 43001–43006, 44200) does not exist yet
 * — no command emits a project-scoped run, and no mechanical producer writes
 * `run.status = blocked` on the turn span. The one project-identifiable signal
 * the desktop can read today is the NIP-MP project collection, so this adapter
 * maps each project to a line and reports everything it cannot source as
 * absent: `recency.lastSpanAt = null`, `blocked = { count: 0, basis: null }`,
 * `cost = null`. The UI renders those as "unknown", never as measured zeros.
 *
 * When the projection lands, this file is the only one that changes.
 */
export function portfolioLineFromProject(project: Project): PortfolioLine {
  return {
    project: { id: project.id, name: project.name },
    recency: { lastSpanAt: null },
    blocked: { count: 0, basis: null },
    cost: null,
  };
}

export type FetchProjectList = () => Promise<Project[]>;

/**
 * @param fetchProjectList injected so the adapter is testable against fixed
 * events without a relay; production callers pass nothing.
 */
export function createTowerBuzzSource(
  fetchProjectList: FetchProjectList = fetchProjects,
): TowerSource {
  return {
    async getPortfolio(): Promise<PortfolioLine[]> {
      try {
        const projects = await fetchProjectList();
        return projects.map(portfolioLineFromProject);
      } catch (cause) {
        // Fail closed: a read failure must reject so the section renders the
        // error branch. Resolving to `[]` here would paint "no lines yet".
        throw new TowerSourceError(
          "adapter_unavailable",
          "Could not read the project source.",
          { cause },
        );
      }
    },
  };
}

export const towerBuzzSource: TowerSource = createTowerBuzzSource();
