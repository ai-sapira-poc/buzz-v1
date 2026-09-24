import assert from "node:assert/strict";
import test from "node:test";

import {
  canZoomIn,
  canZoomOut,
  clampScale,
  clampViewport,
  formatZoom,
  GRAFO_MAX_SCALE,
  GRAFO_MIN_SCALE,
  GRAFO_MIN_VISIBLE_PX,
  panViewport,
  zoomViewport,
} from "./grafoViewport.ts";

const IDENTITY = { tx: 0, ty: 0, scale: 1 };

/** A frame of 1000x400 holding a world of 2000x1600: both axes overflow. */
const OVERFLOWING = {
  frameWidth: 1000,
  frameHeight: 400,
  contentWidth: 2000,
  contentHeight: 1600,
};

/** A frame bigger than the world on both axes. */
const FITTING = {
  frameWidth: 1000,
  frameHeight: 400,
  contentWidth: 300,
  contentHeight: 200,
};

test("pan is a translation and nothing else", () => {
  assert.deepEqual(panViewport(IDENTITY, 10, -4, null), {
    tx: 10,
    ty: -4,
    scale: 1,
  });
});

test("the floor is 1, so a zoom never shrinks the cards' own text", () => {
  // The whole point of the floor: at every reachable scale, a card's data is
  // rendered at least as large as it is at rest.
  assert.equal(GRAFO_MIN_SCALE, 1);
  assert.equal(clampScale(0.1), 1);
  assert.equal(clampScale(0.99), 1);
  assert.equal(canZoomOut(GRAFO_MIN_SCALE), false);
  assert.equal(canZoomOut(GRAFO_MIN_SCALE + 0.01), true);
});

test("the ceiling is bounded, and a press at it does not shift the canvas", () => {
  assert.equal(clampScale(10), GRAFO_MAX_SCALE);
  assert.equal(canZoomIn(GRAFO_MAX_SCALE), false);
  const atMax = { tx: 5, ty: 5, scale: GRAFO_MAX_SCALE };
  assert.deepEqual(zoomViewport(atMax, 1.2, 100, 100, null), atMax);
});

test("zoom keeps the world point under the anchor on the same screen pixel", () => {
  const before = { tx: 30, ty: -12, scale: 1.5 };
  const anchorX = 200;
  const anchorY = 120;
  const worldX = (anchorX - before.tx) / before.scale;
  const worldY = (anchorY - before.ty) / before.scale;

  const after = zoomViewport(before, 1.2, anchorX, anchorY, null);

  assert.ok(Math.abs(after.scale - before.scale * 1.2) < 1e-9);
  assert.ok(Math.abs(after.tx + worldX * after.scale - anchorX) < 1e-9);
  assert.ok(Math.abs(after.ty + worldY * after.scale - anchorY) < 1e-9);
});

test("pan is bounded: a slice of the world always stays in the frame", () => {
  // Drag far past every edge; the world still overlaps the frame.
  const dragged = panViewport(IDENTITY, 99_999, 99_999, OVERFLOWING);
  const width = OVERFLOWING.contentWidth * dragged.scale;
  const height = OVERFLOWING.contentHeight * dragged.scale;
  assert.equal(dragged.tx, OVERFLOWING.frameWidth - GRAFO_MIN_VISIBLE_PX);
  assert.ok(dragged.tx + width >= GRAFO_MIN_VISIBLE_PX);

  const back = panViewport(IDENTITY, -99_999, -99_999, OVERFLOWING);
  assert.ok(back.tx + width >= GRAFO_MIN_VISIBLE_PX);
  assert.ok(back.ty + height >= GRAFO_MIN_VISIBLE_PX);
});

test("a world smaller than the frame is kept wholly inside it", () => {
  // Dragging to either limit slides the small world but never off the frame.
  const right = panViewport(IDENTITY, 5000, 5000, FITTING);
  assert.equal(right.tx, FITTING.frameWidth - FITTING.contentWidth);
  assert.equal(right.ty, FITTING.frameHeight - FITTING.contentHeight);
  const left = panViewport(IDENTITY, -500, -500, FITTING);
  assert.deepEqual(left, IDENTITY);
});

test("clamping is a no-op with no frame to clamp against", () => {
  const wild = { tx: 9e6, ty: -9e6, scale: 2 };
  assert.deepEqual(clampViewport(wild, null), wild);
});

test("the identity transform is always reachable after a clamp", () => {
  // `Reset view` sets the identity, and the identity must survive the clamp:
  // otherwise the recovery control would itself be out of bounds.
  assert.deepEqual(clampViewport(IDENTITY, OVERFLOWING), IDENTITY);
  assert.deepEqual(clampViewport(IDENTITY, FITTING), IDENTITY);
});

test("the zoom figure is the operator's percentage", () => {
  assert.equal(formatZoom(1), "100%");
  assert.equal(formatZoom(1.25), "125%");
  assert.equal(formatZoom(2), "200%");
});
