import * as React from "react";

import type { HandoverRow } from "@/features/tower/domain/handover";
import type { PortfolioLine } from "@/features/tower/domain/portfolio";
import type { HandoverView } from "./handoverState";
import { GrafoCard } from "./GrafoCard";
import { GrafoEdges } from "./GrafoEdges";
import { computeGrafoLayout, GRAFO_ROW_GAP, layerLabel } from "./grafoLayers";
import { formatZoom, GRAFO_ZOOM_STEP, useGrafoViewport } from "./grafoViewport";

/**
 * The canvas: one column per **depth in this window**, cards inside, and the
 * handoff edges drawn between them as arrows from the parent job to the child.
 * Depth comes from the handoff path (the handoff edge), measured against the two
 * bounded reads — never presented as an absolute hierarchy
 * (`architecture/tower-grafo-D-decisiones.md` §1). Columns are the layout, not
 * a role grouping: the role rides each card.
 *
 * Cards and edges live in **one** transformed world, so pan and zoom move both
 * together by construction. The edge read (`handovers`) is a second, bounded
 * read; when it is loading, failed or carried nothing, the canvas draws no edge
 * and says why in words — a missing edge read is never painted as "no handoffs".
 *
 * Keyboard contract: the canvas is a single tab stop for its **cards**. One card
 * carries `tabIndex={0}` (the active card) and the rest `-1` — the roving
 * tabindex the portfolio list already uses. Arrow keys walk the reading order
 * (layer by layer), Home/End jump to the ends. Panning is a pointer gesture; a
 * keyboard user reaches a panned-away card by activating the `Reset view`
 * control, which is focusable. Full keyboard navigation of the canvas remains a
 * later stage's contract; this stage guarantees reachability and a walkable
 * order.
 *
 * `focusOnMount` is the spec §6 hand-off the section owns: it is true only on
 * the commit that follows the operator's own `Retry`, never on a plain
 * loading → data transition.
 */

/** The viewport's fixed height, in rem so it follows the app's zoom. */
const VIEWPORT_HEIGHT_CLASS = "h-[35rem]";

/** `h-44` is 11rem = 176px, the fixed card height the layout is built on. */
const GRAFO_CARD_HEIGHT_CLASS = "h-44";

/** A stable empty edge list, so a missing read does not recompute the layout. */
const EMPTY_HANDOVERS: HandoverRow[] = [];

/**
 * What the canvas says when it is drawing no edge. The distinction is the point:
 * "the read failed", "the read is empty" and "no edge reader is mounted" are
 * different facts, and an empty state that reads as any of the others is the
 * defect this branch exists to prevent.
 */
export function edgeStatusNote(
  handovers: HandoverView | null | undefined,
  drawnEdges: number,
): string | null {
  if (handovers === null || handovers === undefined) {
    return "No edge reader is mounted on this surface, so no edge is drawn.";
  }
  if (handovers.phase === "loading" && handovers.lines === null) {
    return "Reading the handoff edges…";
  }
  if (handovers.phase === "unreachable" && handovers.lines === null) {
    return "The handoff edge read failed, so no edge is drawn. The handoff section below states the failure.";
  }
  if (handovers.lines === null) return "No handoff edge read yet.";
  if (handovers.lines.length === 0) {
    return "No handoff edge in this window.";
  }
  if (drawnEdges === 0) {
    return "The edge read carried no drawable edge.";
  }
  return null;
}

/** A card for an edge endpoint that has no portfolio line in the window. */
const OrphanCard = React.forwardRef<
  HTMLLIElement,
  { jobId: string } & React.ComponentPropsWithoutRef<"li">
>(function OrphanCard({ jobId, className, ...rest }, ref) {
  return (
    <li
      className={`flex ${GRAFO_CARD_HEIGHT_CLASS} min-w-0 flex-col gap-2 overflow-hidden rounded-xl border border-dashed border-l-4 border-border/70 border-l-border bg-card/40 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      data-testid="tower-node"
      data-orphan="true"
      ref={ref}
      {...rest}
    >
      <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground">
        {jobId}
      </span>
      <p className="text-xs text-muted-foreground">
        No line for this job in the window — it is named by a handoff edge, not
        by its own lifecycle event.
      </p>
      <span
        className="text-2xs text-muted-foreground"
        data-testid="tower-node-state"
      >
        No run reported
      </span>
    </li>
  );
});

// `h-44` is 11rem = 176px, the fixed card height the layout is built on.

export function GrafoCanvas({
  lines,
  handovers = null,
  focusOnMount = false,
}: {
  lines: PortfolioLine[];
  /** The edge read; absent means no reader is mounted on this surface. */
  handovers?: HandoverView | null;
  /** Focus the active card on mount — the post-Retry hand-off (spec §6). */
  focusOnMount?: boolean;
}) {
  const handoverRows: HandoverRow[] = handovers?.lines ?? EMPTY_HANDOVERS;
  const layout = React.useMemo(
    () => computeGrafoLayout(lines, handoverRows),
    [lines, handoverRows],
  );
  const indexByJob = React.useMemo(() => {
    const index = new Map<string, number>();
    for (const [at, node] of layout.nodes.entries()) index.set(node.jobId, at);
    return index;
  }, [layout.nodes]);

  const [activeIndex, setActiveIndex] = React.useState(0);
  const cardRefs = React.useRef<Array<HTMLLIElement | null>>([]);

  React.useEffect(() => {
    if (!focusOnMount) return;
    cardRefs.current[activeIndex]?.focus();
  }, [focusOnMount, activeIndex]);

  // A refetch that moves or shrinks the canvas must not leave the tab stop on a
  // card that no longer exists, or the canvas would silently drop out of the
  // tab order.
  React.useEffect(() => {
    setActiveIndex((current) =>
      Math.min(current, Math.max(0, layout.nodes.length - 1)),
    );
  }, [layout.nodes.length]);

  const focusCard = React.useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, layout.nodes.length - 1));
      setActiveIndex(clamped);
      cardRefs.current[clamped]?.focus();
    },
    [layout.nodes.length],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (layout.nodes.length === 0) return;
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
        focusCard(layout.nodes.length - 1);
        break;
      default:
        break;
    }
  };

  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const { viewport, zoomAt, panBy, reset } = useGrafoViewport();

  // Wheel is bound natively so it can be non-passive: a plain wheel pans the
  // canvas instead of scrolling the page under it, and ctrl/meta + wheel zooms
  // around the pointer.
  React.useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const factor = event.deltaY < 0 ? GRAFO_ZOOM_STEP : 1 / GRAFO_ZOOM_STEP;
        zoomAt(element, factor, event.clientX, event.clientY);
      } else {
        panBy(-event.deltaX, -event.deltaY);
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt, panBy]);

  const pointerOrigin = React.useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Cards are focusable and buttons are actionable: a drag that starts on one
    // of them is not a pan.
    if (
      (event.target as HTMLElement).closest(
        "button, [data-testid='tower-node']",
      )
    ) {
      return;
    }
    pointerOrigin.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const origin = pointerOrigin.current;
    if (origin === null) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    pointerOrigin.current = { x: event.clientX, y: event.clientY };
    panBy(dx, dy);
  };

  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerOrigin.current === null) return;
    pointerOrigin.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleViewportKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    // Only when the viewport itself holds focus; a card's arrow keys walk cards.
    if (event.target !== viewportRef.current) return;
    switch (event.key) {
      case "+":
      case "=":
        event.preventDefault();
        zoomAt(viewportRef.current, GRAFO_ZOOM_STEP);
        break;
      case "-":
      case "_":
        event.preventDefault();
        zoomAt(viewportRef.current, 1 / GRAFO_ZOOM_STEP);
        break;
      case "0":
        event.preventDefault();
        reset();
        break;
      default:
        break;
    }
  };

  const note = edgeStatusNote(handovers, layout.edges.length);

  return (
    <div className="flex flex-col gap-2">
      <section
        aria-label="Tower Control graph canvas"
        className={`relative overflow-hidden rounded-xl border border-border/70 bg-muted/20 ${VIEWPORT_HEIGHT_CLASS} ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        data-testid="tower-grafo-viewport"
        onKeyDown={handleViewportKeyDown}
        onPointerCancel={endPan}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPan}
        ref={viewportRef}
        style={{ touchAction: "none" }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          data-testid="tower-grafo-canvas"
          style={{
            height: layout.height,
            transform: `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.scale})`,
            width: layout.width,
          }}
        >
          <GrafoEdges layout={layout} />
          {layout.layers.map((layer, layerIndex) => {
            const titleId = `tower-grafo-layer-${layerIndex}`;
            return (
              <div
                className="absolute z-10 flex w-64 flex-col"
                data-testid="tower-grafo-layer"
                key={layer.key}
                style={{ left: layer.x, top: 0 }}
              >
                <div className="flex h-8 items-baseline justify-between gap-2">
                  <h3
                    className="min-w-0 truncate text-xs font-semibold"
                    data-testid="tower-grafo-layer-title"
                    id={titleId}
                  >
                    {layerLabel(layer)}
                  </h3>
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {layer.nodes.length === 1
                      ? "1 card"
                      : `${layer.nodes.length} cards`}
                  </span>
                </div>
                <ul
                  aria-labelledby={titleId}
                  className="flex flex-col"
                  data-testid="tower-grafo-layer-list"
                  onKeyDown={handleKeyDown}
                  style={{ gap: GRAFO_ROW_GAP }}
                >
                  {layer.nodes.map((node) => {
                    const index = indexByJob.get(node.jobId) ?? 0;
                    const setRef = (element: HTMLLIElement | null) => {
                      cardRefs.current[index] = element;
                    };
                    return node.line === null ? (
                      <OrphanCard
                        jobId={node.jobId}
                        key={node.jobId}
                        onFocus={() => setActiveIndex(index)}
                        ref={setRef}
                        tabIndex={index === activeIndex ? 0 : -1}
                      />
                    ) : (
                      <GrafoCard
                        className={`${GRAFO_CARD_HEIGHT_CLASS} overflow-hidden`}
                        key={node.jobId}
                        line={node.line}
                        onFocus={() => setActiveIndex(index)}
                        ref={setRef}
                        tabIndex={index === activeIndex ? 0 : -1}
                      />
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="pointer-events-none absolute right-2 top-2 z-20 flex items-center gap-1 rounded-md border border-border/70 bg-background/90 p-1 shadow-sm">
          <button
            aria-label="Zoom out"
            className="pointer-events-auto rounded px-2 text-sm hover:bg-muted"
            data-testid="tower-grafo-zoom-out"
            onClick={() => zoomAt(viewportRef.current, 1 / GRAFO_ZOOM_STEP)}
            type="button"
          >
            −
          </button>
          <span
            className="pointer-events-auto min-w-10 text-center text-2xs tabular-nums text-muted-foreground"
            data-testid="tower-grafo-zoom-level"
          >
            {formatZoom(viewport.scale)}
          </span>
          <button
            aria-label="Zoom in"
            className="pointer-events-auto rounded px-2 text-sm hover:bg-muted"
            data-testid="tower-grafo-zoom-in"
            onClick={() => zoomAt(viewportRef.current, GRAFO_ZOOM_STEP)}
            type="button"
          >
            +
          </button>
          <button
            aria-label="Reset view"
            className="pointer-events-auto rounded px-2 text-sm hover:bg-muted"
            data-testid="tower-grafo-zoom-reset"
            onClick={reset}
            type="button"
          >
            Reset
          </button>
        </div>
      </section>
      {note === null ? null : (
        <p
          className="text-2xs text-muted-foreground"
          data-testid="tower-grafo-edge-note"
        >
          {note}
        </p>
      )}
    </div>
  );
}
