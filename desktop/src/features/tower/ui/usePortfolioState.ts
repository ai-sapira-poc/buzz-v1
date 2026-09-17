import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { useFocusedRefetchInterval } from "@/shared/lib/useDocumentVisible";
import { towerBuzzSource } from "@/shared/api/towerBuzzSource";
import type { TowerSource } from "@/features/tower/domain/TowerSource";
import { derivePortfolioView, type PortfolioView } from "./portfolioState";

/** Same cadence family as Pulse; only runs while the app is focused. */
export const TOWER_PORTFOLIO_REFETCH_MS = 60_000;

export const towerQueryKeys = {
  portfolio: ["tower", "portfolio"] as const,
};

/**
 * Reads the portfolio through the port and reduces the query result to the
 * section's phase/snapshot view. React Query retains the last successful `data`
 * across a refetch error, which is exactly the snapshot R6 needs.
 *
 * @param source injected for tests; production callers use the Buzz adapter.
 */
export function usePortfolioState(
  source: TowerSource = towerBuzzSource,
): PortfolioView {
  const refetchInterval = useFocusedRefetchInterval(TOWER_PORTFOLIO_REFETCH_MS);
  const query = useQuery({
    queryKey: towerQueryKeys.portfolio,
    queryFn: () => source.getPortfolio(),
    refetchInterval,
    // One retry, not an unbounded ladder: a persistent adapter failure must
    // settle into the error branch instead of amplifying requests.
    retry: 1,
  });

  const retry = React.useCallback(() => {
    void query.refetch();
  }, [query.refetch]);

  return derivePortfolioView(query, retry);
}
