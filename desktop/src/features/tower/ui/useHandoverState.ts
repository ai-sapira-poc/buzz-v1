import { useQuery } from "@tanstack/react-query";

import { useFocusedRefetchInterval } from "@/shared/lib/useDocumentVisible";
import { towerBuzzSource } from "@/shared/api/towerBuzzSource";
import type { TowerSource } from "@/features/tower/domain/TowerSource";
import { deriveHandoverView, type HandoverView } from "./handoverState";

/** Same cadence family as the portfolio; only runs while the app is focused. */
export const TOWER_HANDOVER_REFETCH_MS = 60_000;

export const towerQueryKeys = {
  handovers: ["tower", "handovers"] as const,
};

/**
 * Reads the handoff edges through the port and reduces the query result to the
 * section's phase/snapshot view. React Query keeps the last successful `data`
 * across a refetch error — the snapshot the stale branch needs.
 *
 * @param source injected for tests; production callers use the Buzz adapter.
 */
export function useHandoverState(
  source: TowerSource = towerBuzzSource,
): HandoverView {
  const refetchInterval = useFocusedRefetchInterval(TOWER_HANDOVER_REFETCH_MS);
  const query = useQuery({
    queryKey: towerQueryKeys.handovers,
    queryFn: () => source.getHandovers(),
    refetchInterval,
    retry: 1,
  });

  const retry = () => {
    void query.refetch();
  };

  return deriveHandoverView(query, retry);
}
