import * as React from "react";

import type { HandoverRow } from "@/features/tower/domain/handover";
import type { PortfolioLine } from "@/features/tower/domain/portfolio";
import type { HandoverView } from "./handoverState";
import { GrafoCard, NOT_AVAILABLE } from "./GrafoCard";
import { GrafoEdges } from "./GrafoEdges";
import {
  computeGrafoLayout,
  GRAFO_BASE_ROOT_FONT_SIZE,
  grafoMetrics,
  type GrafoLayout,
  layerLabel,
  roleFor,
} from "./grafoLayers";
import {
  formatZoom,
  GRAFO_ZOOM_STEP,
  type GrafoViewportBounds,
  useGrafoViewport,
} from "./grafoViewport";

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
 * read and it is **required**, not optional: a silent default would turn a
 * caller's omission into "there are no handoffs", which is the one thing an
 * empty edge layer must never mean.
 *
 * Keyboard contract: the canvas is a single tab stop for its **cards**. One card
 * carries `tabIndex={0}` (the active card) and the rest `-1` — the roving
 * tabindex the portfolio list already uses. Arrow keys walk the reading order
 * (layer by layer), Home/End jump to the ends, and focusing a card with the
 * keyboard **pans it into the frame** — a transform creates no scroll, so
 * without that the keyboard would walk to cards the operator cannot see. Zoom
 * has the bare `+` / `-` / `0` keys, which the app's own shortcuts leave free.
 *
 * `focusOnMount` is the spec §6 hand-off the section owns: it is true only on
 * the commit that follows the operator's own `Retry`, never on a plain
 * loading → data transition.
 */

/** The frame's fixed height, in rem so it follows the app's zoom. */
const VIEWPORT_HEIGHT_CLASS = "h-[35rem]";

/** `h-44` is 11rem — the card height the layout is built on, at whatever root. */
const GRAFO_CARD_HEIGHT_CLASS = "h-44";

/** The gap kept between a revealed card and the frame's edge, in px. */
const REVEAL_PADDING_PX = 8;

/**
 * The root font size the app is drawing at, in px.
 *
 * `Cmd +/-` writes this value onto `<html>` (`useWebviewZoomShortcuts.ts`), and
 * the canvas is built from a grid in px whose DOM boxes are rem (contract §4.7),
 * so the grid has to be read at the size those boxes actually take. Guarded for
 * the non-DOM render the unit tests use, and for a stylesheet that has not
 * parsed yet: both fall back to the base size.
 */
function currentRootFontSize(): number {
  if (
    typeof document === "undefined" ||
    typeof getComputedStyle !== "function"
  ) {
    return GRAFO_BASE_ROOT_FONT_SIZE;
  }
  const size = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  return Number.isFinite(size) && size > 0 ? size : GRAFO_BASE_ROOT_FONT_SIZE;
}

/** A stable empty edge list, so a missing read does not recompute the layout. */
const EMPTY_HANDOVERS: HandoverRow[] = [];

/**
 * What the canvas says about the edge read, and which fact it is stating.
 *
 * The distinction is the point: "the read failed", "the read is still running",
 * "the read came back empty" and "the read came back but carried nothing
 * drawable" are four different facts. Only `empty` may be read as "there are no
 * handoffs"; an empty state that reads as any of the others is the defect this
 * branch exists to prevent.
 */
export interface GrafoEdgeNote {
  tone: "loading" | "empty" | "unusable" | "error" | "stale";
  text: string;
}

export function edgeStatusNote(
  view: HandoverView,
  drawnEdges: number,
): GrafoEdgeNote | null {
  const code = view.failure?.code ?? null;
  const why = view.failure?.message ?? "the reader did not report a reason.";
  const suffix = code === null ? "" : ` (${code})`;

  if (view.phase === "unreachable") {
    if (view.lines === null) {
      return {
        tone: "error",
        text: `The handoff edge read failed${suffix}: ${why} No edge is drawn — this is a failed read, not an empty one.`,
      };
    }
    return {
      tone: "stale",
      text: `The edges drawn are the last good read${
        view.lastSuccessAt === null ? "" : ` of ${view.lastSuccessAt}`
      }; the current read failed${suffix}: ${why}`,
    };
  }

  if (view.lines === null) {
    return { tone: "loading", text: "Reading the handoff edges…" };
  }
  if (view.lines.length === 0) {
    return {
      tone: "empty",
      text: "The handoff edge read carried nothing, so no job handed off to another in this window — there are no handoffs.",
    };
  }
  if (drawnEdges === 0) {
    return {
      tone: "unusable",
      text: "The handoff edge read carried rows, but none named two readable jobs, so there is no edge to draw.",
    };
  }
  return null;
}

/**
 * A card for an edge endpoint that has no portfolio line in the window.
 *
 * It draws the vocabulary of absence the surface already has, and no new one:
 * the `jobId` it was named by, the role only if the edge read carried it (else
 * the same placeholder a nameless line gets), "No run reported" for the state
 * nobody published, and "Not available" / "No readable signal" for the figures
 * this surface never had. It is a card for an *edge endpoint*, not for a line:
 * it is in the no-depth band, it carries no count, and it cannot raise
 * "needs attention", which stays a fact about the portfolio read.
 */
const OrphanCard = React.forwardRef<
  HTMLLIElement,
  { jobId: string; roleName: string } & React.ComponentPropsWithoutRef<"li">
>(function OrphanCard({ jobId, roleName, className, ...rest }, ref) {
  return (
    <li
      className={`flex ${GRAFO_CARD_HEIGHT_CLASS} min-w-0 flex-col gap-2 overflow-hidden rounded-xl border border-dashed border-l-4 border-border/70 border-l-border bg-card/40 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      data-orphan="true"
      data-testid="tower-node"
      ref={ref}
      {...rest}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground">
          {jobId}
        </span>
        <span
          className="shrink-0 rounded-sm border border-border/60 bg-muted/40 px-1 text-2xs"
          data-testid="tower-node-state"
        >
          No run reported
        </span>
      </div>
      <span
        className="min-w-0 truncate text-xs font-medium"
        data-testid="tower-node-role"
      >
        {roleName}
      </span>
      <p className="text-xs text-muted-foreground">
        Named by a handoff edge, not by a line in this window.
      </p>
      <dl className="flex flex-col gap-0.5 text-2xs text-muted-foreground">
        <div className="flex justify-between gap-2">
          <dt>Last activity</dt>
          <dd className="italic">No readable signal</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Model</dt>
          <dd>{NOT_AVAILABLE}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Cost</dt>
          <dd>{NOT_AVAILABLE}</dd>
        </div>
      </dl>
    </li>
  );
});

/**
 * The layers, memoised on everything a pan cannot change.
 *
 * A drag moves the world's container; it is not an edge read and not a new
 * layout, so the card subtree must not re-render while the pointer is down.
 * Every prop below is stable across a pan, which is what makes `React.memo`
 * effective (a single fresh object or arrow defeats it).
 */
const GrafoLayers = React.memo(function GrafoLayers({
  layout,
  activeIndex,
  cardRefs,
  onFocusIndex,
  onKeyDown,
  onSelectIndex,
}: {
  layout: GrafoLayout;
  activeIndex: number;
  cardRefs: React.MutableRefObject<Array<HTMLLIElement | null>>;
  onFocusIndex: (index: number) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLUListElement>) => void;
  onSelectIndex: (index: number) => void;
}) {
  return (
    <>
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
              onKeyDown={onKeyDown}
              style={{ gap: layout.metrics.rowGap }}
            >
              {layer.nodes.map((node) => {
                const index = node.index;
                const setRef = (element: HTMLLIElement | null) => {
                  cardRefs.current[index] = element;
                };
                const shared = {
                  onFocus: () => onFocusIndex(index),
                  onMouseDown: () => onSelectIndex(index),
                  ref: setRef,
                  tabIndex: index === activeIndex ? 0 : -1,
                };
                return node.line === null ? (
                  <OrphanCard
                    {...shared}
                    jobId={node.jobId}
                    key={node.jobId}
                    roleName={roleFor(node)}
                  />
                ) : (
                  <GrafoCard
                    {...shared}
                    className={`${GRAFO_CARD_HEIGHT_CLASS} overflow-hidden`}
                    key={node.jobId}
                    line={node.line}
                    roleName={roleFor(node)}
                  />
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
});

export function GrafoCanvas({
  lines,
  handovers,
  focusOnMount = false,
}: {
  lines: PortfolioLine[];
  /** The edge read. Required: an omitted reader must not read as "no edges". */
  handovers: HandoverView;
  /** Focus the active card on mount — the post-Retry hand-off (spec §6). */
  focusOnMount?: boolean;
}) {
  const handoverRows: HandoverRow[] = handovers.lines ?? EMPTY_HANDOVERS;

  // `Cmd +/-` moves the root font size, so the grid the layout is built on has
  // to follow it or the rem boxes leave the px grid behind (§4.7). The frame is
  // `h-[35rem]`, so a root change resizes it and a ResizeObserver sees it; the
  // observer is the only trigger, so a pan or a zoom never recomputes a layout.
  const [rootFontSize, setRootFontSize] =
    React.useState<number>(currentRootFontSize);
  const metrics = React.useMemo(
    () => grafoMetrics(rootFontSize),
    [rootFontSize],
  );
  const layout = React.useMemo(
    () => computeGrafoLayout(lines, handoverRows, metrics),
    [lines, handoverRows, metrics],
  );

  const [activeIndex, setActiveIndex] = React.useState(0);
  const cardRefs = React.useRef<Array<HTMLLIElement | null>>([]);
  const viewportRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    const frame = viewportRef.current;
    if (frame === null || typeof ResizeObserver === "undefined") return;
    const sync = () => setRootFontSize(currentRootFontSize());
    const observer = new ResizeObserver(sync);
    observer.observe(frame);
    // The observer fires on the next frame; read once now so a frame that
    // mounted under a non-default root is correct immediately.
    sync();
    return () => observer.disconnect();
  }, []);

  // Stable across a pan: the drag reads the current layout through refs, so its
  // callbacks never need to be rebuilt (a rebuilt callback would defeat the
  // memo on the card subtree).
  const nodeCountRef = React.useRef(layout.nodes.length);
  nodeCountRef.current = layout.nodes.length;
  const layoutRef = React.useRef(layout);
  layoutRef.current = layout;

  const currentBounds = React.useCallback((): GrafoViewportBounds | null => {
    const frame = viewportRef.current;
    if (frame === null) return null;
    const current = layoutRef.current;
    return {
      frameWidth: frame.clientWidth,
      frameHeight: frame.clientHeight,
      contentWidth: current.width,
      contentHeight: current.height,
    };
  }, []);

  const { viewport, canZoomIn, canZoomOut, zoomAt, panBy, reset } =
    useGrafoViewport();

  /** Pan the frame so a card is inside it: a transform creates no scroll. */
  const revealCard = React.useCallback(
    (element: HTMLLIElement | null | undefined) => {
      const frame = viewportRef.current;
      if (element === null || element === undefined || frame === null) return;
      const card = element.getBoundingClientRect();
      const box = frame.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      if (card.left < box.left + REVEAL_PADDING_PX) {
        dx = box.left + REVEAL_PADDING_PX - card.left;
      } else if (card.right > box.right - REVEAL_PADDING_PX) {
        dx = box.right - REVEAL_PADDING_PX - card.right;
      }
      if (card.top < box.top + REVEAL_PADDING_PX) {
        dy = box.top + REVEAL_PADDING_PX - card.top;
      } else if (card.bottom > box.bottom - REVEAL_PADDING_PX) {
        dy = box.bottom - REVEAL_PADDING_PX - card.bottom;
      }
      if (dx !== 0 || dy !== 0) panBy(dx, dy, currentBounds());
    },
    [panBy, currentBounds],
  );

  React.useEffect(() => {
    if (!focusOnMount) return;
    const element = cardRefs.current[activeIndex];
    element?.focus();
    revealCard(element);
  }, [focusOnMount, activeIndex, revealCard]);

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
      const clamped = Math.max(
        0,
        Math.min(index, Math.max(0, nodeCountRef.current - 1)),
      );
      setActiveIndex(clamped);
      const element = cardRefs.current[clamped];
      element?.focus();
      revealCard(element);
    },
    [revealCard],
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      const count = nodeCountRef.current;
      if (count === 0) return;
      const active = cardRefs.current.findIndex(
        (element) =>
          element !== null &&
          element === (document.activeElement as HTMLElement | null),
      );
      const from = active === -1 ? 0 : active;
      // The bare `+` / `-` / `0` keys are free: the app's own zoom shortcut
      // requires the primary modifier, and the arrows keep walking the cards.
      switch (event.key) {
        case "+":
        case "=":
          event.preventDefault();
          zoomAt(viewportRef.current, currentBounds(), GRAFO_ZOOM_STEP);
          break;
        case "-":
        case "_":
          event.preventDefault();
          zoomAt(viewportRef.current, currentBounds(), 1 / GRAFO_ZOOM_STEP);
          break;
        case "0":
          event.preventDefault();
          reset();
          break;
        case "ArrowRight":
        case "ArrowDown":
          event.preventDefault();
          focusCard(from + 1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          event.preventDefault();
          focusCard(from - 1);
          break;
        case "Home":
          event.preventDefault();
          focusCard(0);
          break;
        case "End":
          event.preventDefault();
          focusCard(count - 1);
          break;
        default:
          break;
      }
    },
    [currentBounds, focusCard, reset, zoomAt],
  );

  const handleFocusIndex = React.useCallback((index: number) => {
    setActiveIndex(index);
  }, []);
  const handleSelectIndex = React.useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  // Cards are focusable and buttons are actionable: a drag that starts on one
  // of them is not a pan.
  const pointerOrigin = React.useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
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

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const origin = pointerOrigin.current;
    if (origin === null) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    pointerOrigin.current = { x: event.clientX, y: event.clientY };
    panBy(dx, dy, currentBounds());
  };

  const endPan = (event: React.PointerEvent<HTMLElement>) => {
    if (pointerOrigin.current === null) return;
    pointerOrigin.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const note = edgeStatusNote(handovers, layout.edges.length);

  return (
    <div className="flex flex-col gap-2">
      {/*
        The frame: it clips the transformed world, so no pan or zoom can widen
        the page or the Tower column. Wheel is deliberately **not** bound here —
        a plain wheel belongs to the page, and the app reserves the modified
        wheel for the webview's own zoom.
      */}
      <section
        aria-label="Tower Control graph canvas"
        className={`relative overflow-hidden rounded-xl border border-border/70 bg-muted/20 ${VIEWPORT_HEIGHT_CLASS} ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        data-testid="tower-grafo-viewport"
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
          <GrafoLayers
            activeIndex={activeIndex}
            cardRefs={cardRefs}
            layout={layout}
            onFocusIndex={handleFocusIndex}
            onKeyDown={handleKeyDown}
            onSelectIndex={handleSelectIndex}
          />
        </div>

        {/* The way back, outside the transformed subtree: if it travelled with
            the content it would leave the frame along with it. */}
        <div className="pointer-events-none absolute right-2 top-2 z-20 flex items-center gap-1 rounded-md border border-border/70 bg-background/90 p-1 shadow-sm">
          <button
            aria-label="Zoom out"
            className="pointer-events-auto rounded px-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="tower-grafo-zoom-out"
            disabled={!canZoomOut}
            onClick={() =>
              zoomAt(viewportRef.current, currentBounds(), 1 / GRAFO_ZOOM_STEP)
            }
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
            className="pointer-events-auto rounded px-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="tower-grafo-zoom-in"
            disabled={!canZoomIn}
            onClick={() =>
              zoomAt(viewportRef.current, currentBounds(), GRAFO_ZOOM_STEP)
            }
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
          data-tone={note.tone}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}
