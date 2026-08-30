import { useQuery } from "@tanstack/react-query";

import { invokeTauri } from "@/shared/api/tauri";
import type { BuildInfo } from "@/shared/lib/buildIdentity";

/**
 * The build's identity, baked in at compile time.
 *
 * Never changes while the process lives, so it is fetched once and kept
 * forever — no staleness, no refetch on mount.
 */
export function useBuildIdentity() {
  return useQuery<BuildInfo>({
    queryKey: ["build-info"],
    queryFn: () => invokeTauri<BuildInfo>("get_build_info"),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}
