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
      {/* The contract's §4 loading literal, in the surface and not only in the
          spoken line: a bare skeleton is indistinguishable from a surface that
          never loaded (the gate 3% defect). The six-column header stays below
          it (D-8). */}
      <p
        className="border-b border-border/50 px-3 py-2.5 text-sm text-muted-foreground"
        data-testid="panel-loading-text"
      >
        Leyendo — aún buscando, no es un vacío
      </p>
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
