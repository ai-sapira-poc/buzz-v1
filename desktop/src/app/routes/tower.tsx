import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { usePreviewFeatureWarning } from "@/shared/features";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const TowerScreen = React.lazy(async () => {
  const module = await import("@/features/tower/ui/TowerScreen");
  return { default: module.TowerScreen };
});

export const Route = createFileRoute("/tower")({
  component: TowerRouteComponent,
});

function TowerRouteComponent() {
  usePreviewFeatureWarning("tower");
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="tower" />}>
      <TowerScreen />
    </React.Suspense>
  );
}
