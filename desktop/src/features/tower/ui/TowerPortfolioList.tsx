import * as React from "react";

import type { PortfolioLine } from "@/features/tower/domain/portfolio";
import { PortfolioRow } from "./PortfolioRow";
import { orderPortfolioLines } from "./portfolioState";

const GRID =
  "grid gap-2 px-3 sm:grid-cols-[minmax(12rem,2fr)_repeat(3,minmax(7rem,1fr))] sm:gap-3";

/**
 * The portfolio. A supervision list, not a table: rows carry their own state,
 * so the column header is a visual label with `role="presentation"` and the
 * list itself is one `role="list"`.
 *
 * Keyboard contract (spec §6): the list is a single tab stop. One row carries
 * `tabIndex={0}` (the active row) and the rest `-1` — the roving tabindex. Arrow
 * keys move focus between rows; Home/End jump to the ends. Rows are read-only:
 * focus moves, but the row does not navigate.
 */
export function TowerPortfolioList({
  lines,
  refreshing,
  focusOnMount = false,
}: {
  lines: PortfolioLine[];
  refreshing: boolean;
  /**
   * Set only for the one legitimate hand-off (spec §6): the list mounted
   * because the operator's `Retry` resolved, so focus follows their action
   * into the list. Ordinary mounts (loading → data, a refetch) never steal
   * focus — the default keeps the list out of the focus path entirely.
   */
  focusOnMount?: boolean;
}) {
  const ordered = React.useMemo(() => orderPortfolioLines(lines), [lines]);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const rowRefs = React.useRef<Array<HTMLLIElement | null>>([]);

  React.useEffect(() => {
    if (!focusOnMount) return;
    rowRefs.current[0]?.focus();
  }, [focusOnMount]);

  // A refetch that shrinks the list must not leave the tab stop on a row that
  // no longer exists, or the list would silently drop out of the tab order.
  React.useEffect(() => {
    setActiveIndex((current) =>
      Math.min(current, Math.max(0, ordered.length - 1)),
    );
  }, [ordered.length]);

  const focusRow = React.useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, ordered.length - 1));
      setActiveIndex(clamped);
      rowRefs.current[clamped]?.focus();
    },
    [ordered.length],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (ordered.length === 0) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(activeIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        focusRow(0);
        break;
      case "End":
        event.preventDefault();
        focusRow(ordered.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      className="overflow-hidden rounded-xl border border-border/70 bg-card/40"
      data-testid="tower-portfolio"
    >
      <div
        aria-hidden="true"
        className={`${GRID} hidden border-b border-border/50 bg-muted/40 py-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid`}
        role="presentation"
      >
        <span>Line</span>
        <span>Recency (F-2)</span>
        <span>Blocked (F-1)</span>
        <span>Observed cost (F-3)</span>
      </div>
      <ul
        aria-label="Tower Control portfolio"
        className="divide-y divide-border/50"
        data-testid="tower-portfolio-list"
        onKeyDown={handleKeyDown}
      >
        {ordered.map((line, index) => (
          <PortfolioRow
            key={line.project.id}
            line={line}
            onFocus={() => setActiveIndex(index)}
            ref={(node) => {
              rowRefs.current[index] = node;
            }}
            tabIndex={index === activeIndex ? 0 : -1}
          />
        ))}
      </ul>
      {refreshing ? (
        <p className="border-t border-border/50 px-3 py-1.5 text-2xs text-muted-foreground">
          Refreshing…
        </p>
      ) : null}
    </div>
  );
}
