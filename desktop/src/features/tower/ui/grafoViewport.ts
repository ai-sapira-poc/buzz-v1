import * as React from "react";

/**
 * The canvas viewport transform: a translation and a scale, applied to the
 * single world that holds both the cards and the edge layer. Because cards and
 * edges live in **one** transformed space, a pan or a zoom cannot move one
 * without the other — that is what "in register" means, and it is a property of
 * the structure, not of a synchronisation step that could drift.
 *
 * The math is pure so it can be tested without a DOM; {@link useGrafoViewport}
 * wraps it in React state.
 */

export interface GrafoViewportTransform {
  tx: number;
  ty: number;
  scale: number;
}

/** Zoom bounds. Below 0.4 the cards are unreadable; above 2.5 they are noise. */
export const GRAFO_MIN_SCALE = 0.4;
export const GRAFO_MAX_SCALE = 2.5;

/** One zoom-button step. */
export const GRAFO_ZOOM_STEP = 1.2;

export function clampScale(scale: number): number {
  return Math.min(GRAFO_MAX_SCALE, Math.max(GRAFO_MIN_SCALE, scale));
}

export function panViewport(
  viewport: GrafoViewportTransform,
  dx: number,
  dy: number,
): GrafoViewportTransform {
  return { ...viewport, tx: viewport.tx + dx, ty: viewport.ty + dy };
}

/**
 * Zooms by `factor` keeping the world point under `(anchorX, anchorY)` — in
 * viewport coordinates — fixed on screen. Clamping at the bounds returns the
 * same transform, so a click at the limit does not shift the canvas.
 */
export function zoomViewport(
  viewport: GrafoViewportTransform,
  factor: number,
  anchorX: number,
  anchorY: number,
): GrafoViewportTransform {
  const scale = clampScale(viewport.scale * factor);
  if (scale === viewport.scale) return viewport;
  const worldX = (anchorX - viewport.tx) / viewport.scale;
  const worldY = (anchorY - viewport.ty) / viewport.scale;
  return {
    scale,
    tx: anchorX - worldX * scale,
    ty: anchorY - worldY * scale,
  };
}

/** The zoom figure shown to the operator, as a percentage. */
export function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

const IDENTITY: GrafoViewportTransform = { tx: 0, ty: 0, scale: 1 };

export interface GrafoViewportControls {
  viewport: GrafoViewportTransform;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  /** Zoom around the centre of the element the pointer is over. */
  zoomAt: (
    element: HTMLElement | null,
    factor: number,
    clientX?: number,
    clientY?: number,
  ) => void;
  panBy: (dx: number, dy: number) => void;
  setViewport: React.Dispatch<React.SetStateAction<GrafoViewportTransform>>;
}

/**
 * The viewport lives in component state, which survives a re-render, a refetch
 * and a browser resize: the operator's pan/zoom is never silently reset. It is
 * lost only if the canvas unmounts, which is the honest lifetime of a view of
 * one read.
 */
export function useGrafoViewport(): GrafoViewportControls {
  const [viewport, setViewport] = React.useState(IDENTITY);

  const zoomAt = React.useCallback(
    (
      element: HTMLElement | null,
      factor: number,
      clientX?: number,
      clientY?: number,
    ) => {
      setViewport((current) => {
        let anchorX: number;
        let anchorY: number;
        if (
          element !== null &&
          clientX !== undefined &&
          clientY !== undefined
        ) {
          const rect = element.getBoundingClientRect();
          anchorX = clientX - rect.left;
          anchorY = clientY - rect.top;
        } else if (element !== null) {
          anchorX = element.clientWidth / 2;
          anchorY = element.clientHeight / 2;
        } else {
          anchorX = 0;
          anchorY = 0;
        }
        return zoomViewport(current, factor, anchorX, anchorY);
      });
    },
    [],
  );

  const panBy = React.useCallback(
    (dx: number, dy: number) =>
      setViewport((current) => panViewport(current, dx, dy)),
    [],
  );
  const reset = React.useCallback(() => setViewport(IDENTITY), []);
  const zoomIn = React.useCallback(
    () =>
      setViewport((current) => zoomViewport(current, GRAFO_ZOOM_STEP, 0, 0)),
    [],
  );
  const zoomOut = React.useCallback(
    () =>
      setViewport((current) =>
        zoomViewport(current, 1 / GRAFO_ZOOM_STEP, 0, 0),
      ),
    [],
  );

  return { viewport, zoomIn, zoomOut, reset, zoomAt, panBy, setViewport };
}
