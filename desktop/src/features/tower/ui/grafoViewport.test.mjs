import assert from "node:assert/strict";
import test from "node:test";

import {
  clampScale,
  formatZoom,
  GRAFO_MAX_SCALE,
  GRAFO_MIN_SCALE,
  panViewport,
  zoomViewport,
} from "./grafoViewport.ts";

const IDENTITY = { tx: 0, ty: 0, scale: 1 };

test("pan is a translation and nothing else", () => {
  assert.deepEqual(panViewport(IDENTITY, 10, -4), {
    tx: 10,
    ty: -4,
    scale: 1,
  });
});

test("zoom keeps the world point under the anchor on the same screen pixel", () => {
  const before = { tx: 30, ty: -12, scale: 1.5 };
  const anchorX = 200;
  const anchorY = 120;
  // The world point currently under the anchor.
  const worldX = (anchorX - before.tx) / before.scale;
  const worldY = (anchorY - before.ty) / before.scale;

  const after = zoomViewport(before, 1.2, anchorX, anchorY);

  assert.ok(Math.abs(after.scale - before.scale * 1.2) < 1e-9);
  assert.ok(Math.abs(after.tx + worldX * after.scale - anchorX) < 1e-9);
  assert.ok(Math.abs(after.ty + worldY * after.scale - anchorY) < 1e-9);
});

test("zoom clamps at the bounds and does not shift the canvas", () => {
  const atMax = { tx: 5, ty: 5, scale: GRAFO_MAX_SCALE };
  assert.equal(zoomViewport(atMax, 1.2, 100, 100), atMax);

  const atMin = { tx: 5, ty: 5, scale: GRAFO_MIN_SCALE };
  assert.equal(zoomViewport(atMin, 0.5, 100, 100), atMin);
});

test("clampScale holds the window", () => {
  assert.equal(clampScale(0.1), GRAFO_MIN_SCALE);
  assert.equal(clampScale(10), GRAFO_MAX_SCALE);
  assert.equal(clampScale(1.3), 1.3);
});

test("the zoom figure is the operator's percentage", () => {
  assert.equal(formatZoom(1), "100%");
  assert.equal(formatZoom(1.25), "125%");
  assert.equal(formatZoom(0.4), "40%");
});
