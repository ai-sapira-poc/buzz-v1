import { Skeleton } from "@/shared/ui/skeleton";
import { PanelHeader } from "./PanelList";
import { PANEL_GRID } from "./panelLayout";

const LOADING_ROWS = ["uno", "dos", "tres", "cuatro", "cinco"] as const;

/**
 * The panel while the first read is in flight. The six-column header stays
 * visible (D-8) and no row is drawn half-filled: a provisional "sin señal" would
 * be a claim made before the read answered.
 */
export function PanelLoadingState() {
  return (
    <div
      aria-busy="true"
      className="overflow-hidden rounded-xl border border-border/70 bg-card/40"
      data-testid="panel-loading-state"
    >
      <PanelHeader />
      {LOADING_ROWS.map((row) => (
        <div
          className={`${PANEL_GRID} border-b border-border/50 last:border-b-0`}
          key={row}
        >
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      ))}
    </div>
  );
}
