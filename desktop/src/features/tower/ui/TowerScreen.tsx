import { PageHeader } from "@/shared/ui/PageHeader";
import { TowerSection } from "./TowerSection";
import { usePortfolioState } from "./usePortfolioState";

/**
 * Tower Control — the section. It answers one question without interaction:
 * what the team of agents is doing, how it is going, and whether it needs the
 * operator.
 */
export function TowerScreen() {
  const view = usePortfolioState();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6">
        <PageHeader
          description="Window: session (D-1). What is happening, how it is going, and what needs you."
          title="Tower Control"
        />
        <TowerSection view={view} />
      </div>
    </div>
  );
}
