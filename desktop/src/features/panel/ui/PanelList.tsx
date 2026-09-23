import type { PanelRow } from "@/features/panel/domain/panel";
import { PanelRowView } from "./PanelRow";
import { PANEL_COLUMNS, PANEL_GRID } from "./panelLayout";

/**
 * The six-column header. It is `role="presentation"` and hidden below `sm`:
 * each row carries its own state, so the header is a visual label, not a
 * navigable table. Exported so the loading state can keep it visible (D-8).
 */
export function PanelHeader() {
  return (
    <div
      aria-hidden="true"
      className={`${PANEL_GRID} hidden border-b border-border/50 bg-muted/40 text-2xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid`}
      role="presentation"
    >
      {PANEL_COLUMNS.map((column) => (
        <span key={column}>{column}</span>
      ))}
    </div>
  );
}

/**
 * The panel list. One row per encargo; the rows carry their own state, so the
 * list is one `role="list"` behind the port. Read-only: no row navigates.
 */
export function PanelList({
  rows,
  refreshing,
  handoversUnreadable,
}: {
  rows: PanelRow[];
  refreshing: boolean;
  /** True when the handoff read failed: parent/thread cells must say so. */
  handoversUnreadable: boolean;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-border/70 bg-card/40"
      data-testid="panel-list"
    >
      <PanelHeader />
      <ul
        aria-label="El panel — encargos en la ventana"
        className="divide-y divide-border/50"
        data-testid="panel-list-body"
      >
        {rows.map((row) => (
          <PanelRowView
            handoversUnreadable={handoversUnreadable}
            key={row.jobId}
            row={row}
          />
        ))}
      </ul>
      {refreshing ? (
        <p className="border-t border-border/50 px-3 py-1.5 text-2xs text-muted-foreground">
          Actualizando…
        </p>
      ) : null}
    </div>
  );
}
