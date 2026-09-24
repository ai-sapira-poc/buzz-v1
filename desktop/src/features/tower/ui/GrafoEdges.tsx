import * as React from "react";

import {
  GRAFO_CARD_HEIGHT,
  GRAFO_CARD_WIDTH,
  type GrafoLayout,
} from "./grafoLayers";

/**
 * The edge layer: one arrow per handoff edge (the handoff edge), from the parent
 * job's right edge to the child job's left edge.
 *
 * It is an SVG **in the same world as the cards** — the canvas transforms the
 * two together, so an arrowhead cannot drift off its card under pan or zoom.
 * The arrow is the direction: `marker-end` sits at the child, and the path is
 * always drawn parent → child, never the reverse.
 *
 * The layer is decorative to assistive technology (`aria-hidden`): the same
 * fact travels in text on each card and in the handoff section below, so a
 * screen reader is not asked to read raw geometry.
 */
export function GrafoEdges({ layout }: { layout: GrafoLayout }) {
  const rawId = React.useId();
  // `useId` yields colons, which are awkward inside a `url(#…)` reference;
  // keep only characters an id may safely carry.
  const markerId = `tower-grafo-arrow-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const byJobId = React.useMemo(() => {
    const map = new Map<string, (typeof layout.nodes)[number]>();
    for (const node of layout.nodes) map.set(node.jobId, node);
    return map;
  }, [layout.nodes]);

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0 z-0 text-muted-foreground"
      data-testid="tower-grafo-edge-layer"
      focusable="false"
      height={layout.height}
      width={layout.width}
    >
      <defs>
        <marker
          id={markerId}
          markerHeight="7"
          markerWidth="7"
          orient="auto-start-reverse"
          refX="9"
          refY="5"
          viewBox="0 0 10 10"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
      </defs>
      {layout.edges.map((edge) => {
        const parent = byJobId.get(edge.parentJobId);
        const child = byJobId.get(edge.childJobId);
        if (parent === undefined || child === undefined) return null;
        const x1 = parent.x + GRAFO_CARD_WIDTH;
        const y1 = parent.y + GRAFO_CARD_HEIGHT / 2;
        const x2 = child.x;
        const y2 = child.y + GRAFO_CARD_HEIGHT / 2;
        // A horizontal control offset: the curve leaves the parent to the right
        // and enters the child from the left even when a cycle puts the child at
        // the same or an earlier layer.
        const bend = Math.max(24, Math.abs(x2 - x1) / 2);
        const d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
        return (
          <path
            className="fill-none stroke-current opacity-70"
            d={d}
            data-child={edge.childJobId}
            data-edge-id={edge.id}
            data-orphan={edge.orphan ? "true" : "false"}
            data-outcome={edge.parentOutcome}
            data-parent={edge.parentJobId}
            data-testid="tower-grafo-edge"
            data-x1={x1}
            data-x2={x2}
            data-y1={y1}
            data-y2={y2}
            key={edge.id}
            markerEnd={`url(#${markerId})`}
            strokeLinecap="round"
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}
