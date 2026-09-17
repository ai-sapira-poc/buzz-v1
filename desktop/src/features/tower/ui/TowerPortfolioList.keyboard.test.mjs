import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { JSDOM } from "jsdom";

// jsdom supplies the DOM these tests need; react-dom/server cannot exercise
// focus, which is exactly the contract this file proves (spec §6).
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

before(() => {
  Object.assign(globalThis, {
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    window: dom.window,
  });
});

after(() => dom.window.close());

function line(id) {
  return {
    project: { id, name: id.toUpperCase() },
    recency: { lastSpanAt: null },
    blocked: { count: 0, basis: null },
    cost: null,
  };
}

async function setup(ids = ["a", "b", "c"]) {
  const React = await import("react");
  const { render } = await import("@testing-library/react");
  const { TowerPortfolioList } = await import("./TowerPortfolioList.tsx");
  const result = render(
    React.createElement(TowerPortfolioList, {
      lines: ids.map(line),
      refreshing: false,
    }),
  );
  return {
    ...result,
    rows: result.container.querySelectorAll(
      '[data-testid="tower-portfolio-row"]',
    ),
    list: result.container.querySelector(
      '[data-testid="tower-portfolio-list"]',
    ),
  };
}

test("the list is a single tab stop: one row at tabIndex 0, the rest at -1", async () => {
  const { rows } = await setup();
  assert.equal(rows.length, 3);
  assert.deepEqual(
    [...rows].map((row) => row.getAttribute("tabindex")),
    ["0", "-1", "-1"],
  );
});

test("arrows move focus and carry the roving tabindex with it", async () => {
  const { fireEvent } = await import("@testing-library/react");
  const { rows, list } = await setup();

  fireEvent.focus(rows[0]);
  fireEvent.keyDown(list, { key: "ArrowDown" });
  assert.equal(document.activeElement, rows[1]);
  assert.deepEqual(
    [...rows].map((row) => row.getAttribute("tabindex")),
    ["-1", "0", "-1"],
  );

  fireEvent.keyDown(list, { key: "ArrowUp" });
  assert.equal(document.activeElement, rows[0]);

  // Clamped at the ends, not wrapped.
  fireEvent.keyDown(list, { key: "ArrowUp" });
  assert.equal(document.activeElement, rows[0]);
});

test("Home and End jump to the first and last row", async () => {
  const { fireEvent } = await import("@testing-library/react");
  const { rows, list } = await setup();

  fireEvent.focus(rows[0]);
  fireEvent.keyDown(list, { key: "End" });
  assert.equal(document.activeElement, rows[2]);
  fireEvent.keyDown(list, { key: "Home" });
  assert.equal(document.activeElement, rows[0]);
});

test("the tab stop does not fall off the end when a refetch shrinks the list", async () => {
  const React = await import("react");
  const { render } = await import("@testing-library/react");
  const { TowerPortfolioList } = await import("./TowerPortfolioList.tsx");

  function draw(ids) {
    return React.createElement(TowerPortfolioList, {
      lines: ids.map(line),
      refreshing: false,
    });
  }

  const { container, rerender } = render(draw(["a", "b", "c"]));
  const rowsBefore = container.querySelectorAll(
    '[data-testid="tower-portfolio-row"]',
  );
  const { fireEvent } = await import("@testing-library/react");
  const list = container.querySelector('[data-testid="tower-portfolio-list"]');
  fireEvent.focus(rowsBefore[2]);
  fireEvent.keyDown(list, { key: "End" });

  rerender(draw(["a"]));
  const rowsAfter = container.querySelectorAll(
    '[data-testid="tower-portfolio-row"]',
  );
  assert.deepEqual(
    [...rowsAfter].map((row) => row.getAttribute("tabindex")),
    ["0"],
    "exactly one row must still carry the tab stop",
  );
});
