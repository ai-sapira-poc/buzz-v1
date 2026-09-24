import * as React from "react";

import type { PortfolioLine } from "@/features/tower/domain/portfolio";
import { GrafoCard } from "./GrafoCard";
import { flattenColumns, groupByRole } from "./grafoGroups";

/**
 * The canvas: one column per role, cards inside, **no edges**. Columns are the
 * grouping, not a graph layout — S1 has no edge reader on this surface, so
 * nothing here connects two cards, and the horizontal axis means "which role",
 * not "how deep".
 *
 * Keyboard contract: the whole canvas is a single tab stop. One card carries
 * `tabIndex={0}` (the active card) and the rest `-1` — the roving tabindex the
 * portfolio list already uses. Arrow keys walk the reading order (column by
 * column), Home/End jump to the ends. Cards are read-only: focus moves, the
 * card does not navigate. Full keyboard navigation of the canvas is a later
 * stage's contract; S1 guarantees reachability and a walkable order.
 */
export function GrafoCanvas({ lines }: { lines: PortfolioLine[] }) {
  const columns = React.useMemo(() => groupByRole(lines), [lines]);
  const cards = React.useMemo(() => flattenColumns(columns), [columns]);
  const offsets = React.useMemo(() => {
    const starts = new Map<string, number>();
    let at = 0;
    for (const column of columns) {
      starts.set(column.role, at);
      at += column.cards.length;
    }
    return starts;
  }, [columns]);

  const [activeIndex, setActiveIndex] = React.useState(0);
  const cardRefs = React.useRef<Array<HTMLLIElement | null>>([]);

  // A refetch that moves or shrinks the canvas must not leave the tab stop on a
  // card that no longer exists, or the canvas would silently drop out of the
  // tab order.
  React.useEffect(() => {
    setActiveIndex((current) =>
      Math.min(current, Math.max(0, cards.length - 1)),
    );
  }, [cards.length]);

  const focusCard = React.useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, cards.length - 1));
      setActiveIndex(clamped);
      cardRefs.current[clamped]?.focus();
    },
    [cards.length],
  );

  // Bound on each column's list, not on the canvas wrapper: a bare `div` with a
  // key handler is exactly the static-element interactivity the design system's
  // lint forbids. Focus is always on a card inside one of these lists, so the
  // handler fires on the list that owns the focused card and the index it moves
  // to is the canvas-wide one — the walk crosses columns.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (cards.length === 0) return;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusCard(activeIndex + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusCard(activeIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        focusCard(0);
        break;
      case "End":
        event.preventDefault();
        focusCard(cards.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      className="flex gap-3 overflow-x-auto pb-1"
      data-testid="tower-grafo-canvas"
    >
      {columns.map((column, columnIndex) => {
        const start = offsets.get(column.role) ?? 0;
        const titleId = `tower-grafo-column-${columnIndex}`;
        return (
          <div
            className="flex w-64 shrink-0 flex-col gap-2"
            data-testid="tower-grafo-column"
            key={column.role}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3
                className="min-w-0 truncate text-xs font-semibold"
                data-testid="tower-grafo-column-title"
                id={titleId}
              >
                {column.role}
              </h3>
              <span className="shrink-0 text-2xs text-muted-foreground">
                {column.cards.length === 1
                  ? "1 card"
                  : `${column.cards.length} cards`}
              </span>
            </div>
            {/* The heading is the column's only accessible name; the list
                references it rather than carrying a second copy of it. */}
            <ul
              aria-labelledby={titleId}
              className="flex flex-col gap-2"
              data-testid="tower-grafo-column-list"
              onKeyDown={handleKeyDown}
            >
              {column.cards.map((line, cardIndex) => (
                <GrafoCard
                  key={line.project.id}
                  line={line}
                  onFocus={() => setActiveIndex(start + cardIndex)}
                  ref={(node) => {
                    cardRefs.current[start + cardIndex] = node;
                  }}
                  tabIndex={start + cardIndex === activeIndex ? 0 : -1}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
