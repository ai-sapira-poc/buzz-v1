import { PageHeader } from "@/shared/ui/PageHeader";
import { PanelSection } from "@/features/panel/ui/PanelSection";
import { GrafoSection } from "./GrafoSection";
import { HandoverSection } from "./HandoverSection";
import { useHandoverState } from "./useHandoverState";
import { usePortfolioState } from "./usePortfolioState";

/**
 * Tower Control — the section. It answers one question without interaction:
 * what the team of agents is doing, how it is going, and whether it needs the
 * operator.
 *
 * The portfolio read is presented once, as the canvas ({@link GrafoSection});
 * the canvas reuses the row view's surface states, so the same read never paints
 * two loading/empty/error messages at once. `TowerSection` and its list stay in
 * the repository with their tests — retiring them is a later decision, not part
 * of this stage's contract.
 */
export function TowerScreen() {
  const view = usePortfolioState();
  const handovers = useHandoverState();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6">
        <PageHeader
          description="Window: session (D-1). What is happening, how it is going, and what needs you."
          title="Tower Control"
        />
        <GrafoSection handovers={handovers} view={view} />
        <PanelSection handovers={handovers} portfolio={view} />
        <HandoverSection view={handovers} />
      </div>
    </div>
  );
}
