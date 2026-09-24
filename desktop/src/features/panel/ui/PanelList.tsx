import type { PanelRow } from "@/features/panel/domain/panel";
import { PanelRowView } from "./PanelRow";
import {
  PANEL_COLUMNS,
  PANEL_COLUMNS_NO_HANDOFF,
  PANEL_GRID,
  PANEL_GRID_NO_HANDOFF,
  type HandoverColumnState,
} from "./panelLayout";

/**
 * The six-column header. It is `role="presentation"` and hidden below `sm`:
 * each row carries its own state, so the header is a visual label, not a
 * navigable table. Exported so the loading state can keep it visible (D-8).
 *
 * `handoffColumn` is false only when P3's column is retired whole: the header
 * must then drop that column too, or the header would name a column no row
 * draws.
 */
export function PanelHeader({
  handoffColumn = true,
}: {
  handoffColumn?: boolean;
} = {}) {
  const columns = handoffColumn ? PANEL_COLUMNS : PANEL_COLUMNS_NO_HANDOFF;
  return (
    <div
      aria-hidden="true"
      className={`${handoffColumn ? PANEL_GRID : PANEL_GRID_NO_HANDOFF} hidden border-b border-border/50 bg-muted/40 text-2xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid`}
      role="presentation"
    >
      {columns.map((column) => (
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
  handoverColumn,
  readFailed,
  lastGoodAt,
}: {
  rows: PanelRow[];
  refreshing: boolean;
  /** True when the handoff read failed: the thread cell must say so. */
  handoversUnreadable: boolean;
  /** P3's column state for this render, shared by the header and every row. */
  handoverColumn: HandoverColumnState;
  /** True when the portfolio read failed: the wait cell must not claim now. */
  readFailed: boolean;
  /** The instant of the last good portfolio read, when there is one. */
  lastGoodAt: string | null;
}) {
  const handoffRetired = handoverColumn.state === "retired";
  return (
    <div
      className="overflow-hidden rounded-xl border border-border/70 bg-card/40"
      data-testid="panel-list"
    >
      <PanelHeader handoffColumn={!handoffRetired} />
      <ul
        aria-label="El panel — encargos en la ventana"
        className="divide-y divide-border/50"
        data-testid="panel-list-body"
      >
        {rows.map((row) => (
          <PanelRowView
            handoverColumn={handoverColumn}
            handoversUnreadable={handoversUnreadable}
            key={row.jobId}
            lastGoodAt={lastGoodAt}
            readFailed={readFailed}
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
