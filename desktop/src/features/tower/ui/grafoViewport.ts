import * as React from "react";

/**
 * The canvas viewport transform: a translation and a scale, applied to the
 * single world that holds both the cards and the edge layer. Because cards and
 * edges live in **one** transformed space, a pan or a zoom cannot move one
 * without the other — that is what "in register" means, and it is a property of
 * the structure, not of a synchronisation step that could drift.
 *
 * **Zoom only ever magnifies** (floor `scale = 1`). That is a decision with a
 * reason: the canvas scales *cards*, so a scale below 1 would render the job id
 * and the state chip smaller than at rest — the operator would lose the data to
 * gain a bird's-eye view. Instead the reachable area is covered with pan. The
 * ceiling is bounded the other way: past it a zoom only adds empty space.
 *
 * Pan is **bounded**: the world can never leave the frame, so the operator can
 * always see where the content is (and the `Reset view` control is always
 * there).
 *
 * The math is pure so it can be tested without a DOM; {@link useGrafoViewport}
 * wraps it in React state.
 */

export interface GrafoViewportTransform {
  tx: number;
  ty: number;
  scale: number;
}

/**
 * Zoom bounds. The floor is 1 **on purpose**: mutating the card subtree with a
 * scale below 1 renders the job id and the state chip legibly smaller than at
 * rest, which trades the datum for the overview.
 */
export const GRAFO_MIN_SCALE = 1;
/** Above 2× a zoom only adds empty space and paint cost. */
export const GRAFO_MAX_SCALE = 2;

/** One zoom-button step. */
export const GRAFO_ZOOM_STEP = 1.2;

/**
 * The least slice of the world that always stays inside the frame, in px — a
 * pan can never leave the operator looking at an empty canvas.
 */
export const GRAFO_MIN_VISIBLE_PX = 96;

/** The world and the frame it is shown in, in px (the frame's own size). */
export interface GrafoViewportBounds {
  frameWidth: number;
  frameHeight: number;
  contentWidth: number;
  contentHeight: number;
}

export const GRAFO_IDENTITY: GrafoViewportTransform = {
  tx: 0,
  ty: 0,
  scale: 1,
};

export function clampScale(scale: number): number {
  return Math.min(GRAFO_MAX_SCALE, Math.max(GRAFO_MIN_SCALE, scale));
}

export function canZoomIn(scale: number): boolean {
  return scale < GRAFO_MAX_SCALE;
}

export function canZoomOut(scale: number): boolean {
  return scale > GRAFO_MIN_SCALE;
}

/**
 * One axis' admissible translations.
 *
 * Content taller/wider than the frame keeps {@link GRAFO_MIN_VISIBLE_PX} of
 * itself inside; content that fits is kept wholly inside, so a small graph
 * cannot be dragged out of sight at all.
 */
function axisRange(content: number, frame: number): [number, number] {
  if (content <= frame) return [0, Math.max(0, frame - content)];
  return [GRAFO_MIN_VISIBLE_PX - content, frame - GRAFO_MIN_VISIBLE_PX];
}

export function clampViewport(
  viewport: GrafoViewportTransform,
  bounds: GrafoViewportBounds | null,
): GrafoViewportTransform {
  if (bounds === null) return viewport;
  const [minTx, maxTx] = axisRange(
    bounds.contentWidth * viewport.scale,
    bounds.frameWidth,
  );
  const [minTy, maxTy] = axisRange(
    bounds.contentHeight * viewport.scale,
    bounds.frameHeight,
  );
  return {
    scale: viewport.scale,
    tx: Math.min(maxTx, Math.max(minTx, viewport.tx)),
    ty: Math.min(maxTy, Math.max(minTy, viewport.ty)),
  };
}

export function panViewport(
  viewport: GrafoViewportTransform,
  dx: number,
  dy: number,
  bounds: GrafoViewportBounds | null,
): GrafoViewportTransform {
  return clampViewport(
    { ...viewport, tx: viewport.tx + dx, ty: viewport.ty + dy },
    bounds,
  );
}

/**
 * Zooms by `factor` keeping the world point under `(anchorX, anchorY)` — in
 * frame coordinates — fixed on screen, then re-clamps. At a bound the transform
 * is returned unchanged, so a press at the limit does not shift the canvas.
 */
export function zoomViewport(
  viewport: GrafoViewportTransform,
  factor: number,
  anchorX: number,
  anchorY: number,
  bounds: GrafoViewportBounds | null,
): GrafoViewportTransform {
  const scale = clampScale(viewport.scale * factor);
  if (scale === viewport.scale) return clampViewport(viewport, bounds);
  const worldX = (anchorX - viewport.tx) / viewport.scale;
  const worldY = (anchorY - viewport.ty) / viewport.scale;
  return clampViewport(
    {
      scale,
      tx: anchorX - worldX * scale,
      ty: anchorY - worldY * scale,
    },
    bounds,
  );
}

/** The zoom figure shown to the operator, as a percentage. */
export function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export interface GrafoViewportControls {
  viewport: GrafoViewportTransform;
  canZoomIn: boolean;
  canZoomOut: boolean;
  /** Zoom around a frame point (default: the frame's centre). */
  zoomAt: (
    frame: HTMLElement | null,
    bounds: GrafoViewportBounds | null,
    factor: number,
    clientX?: number,
    clientY?: number,
  ) => void;
  panBy: (dx: number, dy: number, bounds: GrafoViewportBounds | null) => void;
  reset: () => void;
}

/**
 * The viewport lives in component state, which survives a re-render, a refetch
 * and a browser resize: the operator's pan/zoom is never silently reset. It is
 * lost only if the canvas unmounts, which is the honest lifetime of a view of
 * one read.
 */
export function useGrafoViewport(): GrafoViewportControls {
  const [viewport, setViewport] = React.useState(GRAFO_IDENTITY);

  const zoomAt = React.useCallback(
    (
      frame: HTMLElement | null,
      bounds: GrafoViewportBounds | null,
      factor: number,
      clientX?: number,
      clientY?: number,
    ) => {
      setViewport((current) => {
        let anchorX = 0;
        let anchorY = 0;
        if (frame !== null) {
          if (clientX !== undefined && clientY !== undefined) {
            const rect = frame.getBoundingClientRect();
            anchorX = clientX - rect.left;
            anchorY = clientY - rect.top;
          } else {
            anchorX = frame.clientWidth / 2;
            anchorY = frame.clientHeight / 2;
          }
        }
        return zoomViewport(current, factor, anchorX, anchorY, bounds);
      });
    },
    [],
  );

  const panBy = React.useCallback(
    (dx: number, dy: number, bounds: GrafoViewportBounds | null) => {
      setViewport((current) => panViewport(current, dx, dy, bounds));
    },
    [],
  );
  const reset = React.useCallback(() => setViewport(GRAFO_IDENTITY), []);

  return {
    viewport,
    canZoomIn: canZoomIn(viewport.scale),
    canZoomOut: canZoomOut(viewport.scale),
    zoomAt,
    panBy,
    reset,
  };
}
