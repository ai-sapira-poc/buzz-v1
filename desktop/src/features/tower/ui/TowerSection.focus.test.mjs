import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { JSDOM } from "jsdom";

// Spec §6: the only moment the section may move focus is after the operator's
// own Retry resolves into a list. A loading → data transition must not steal
// focus, the stale-banner Retry (which leaves the list mounted) must not pull
// focus out of wherever the operator left it, and moving focus off the retry
// button while the read is in flight cancels the hand-off. react-dom/server
// cannot exercise focus, so this file mounts into jsdom like the list keyboard
// test. Queries are scoped to the container: renders are not torn down between
// tests, so a document-wide query would match a previous test's tree.
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
    work: null,
  };
}

function view(overrides = {}) {
  return {
    phase: "ready",
    lines: null,
    lastSuccessAt: null,
    failure: null,
    refreshing: false,
    retry: () => {},
    ...overrides,
  };
}

async function mount(portfolioView) {
  const React = await import("react");
  const { render } = await import("@testing-library/react");
  const { TowerSection } = await import("./TowerSection.tsx");
  const result = render(
    React.createElement(TowerSection, { view: portfolioView }),
  );
  return {
    ...result,
    draw: (next) =>
      result.rerender(React.createElement(TowerSection, { view: next })),
    rows: () =>
      result.container.querySelectorAll('[data-testid="tower-portfolio-row"]'),
    retryButton: () => result.container.querySelector("button"),
  };
}

test("a resolved Retry hands focus to the first portfolio row", async () => {
  const { fireEvent } = await import("@testing-library/react");
  const started = await mount(
    view({
      phase: "unreachable",
      lines: null,
      failure: { code: "adapter_unavailable", message: "no relay" },
    }),
  );

  fireEvent.click(started.retryButton());
  started.draw(view({ phase: "ready", lines: [line("a"), line("b")] }));

  const rows = started.rows();
  assert.equal(rows.length, 2);
  assert.equal(document.activeElement, rows[0]);
});

test("a plain loading to data transition does not steal focus", async () => {
  const started = await mount(view({ phase: "loading", lines: null }));
  started.draw(view({ phase: "ready", lines: [line("a")] }));

  const rows = started.rows();
  assert.equal(rows.length, 1);
  assert.notEqual(document.activeElement, rows[0]);
});

test("the stale-banner Retry does not pull focus into the already-mounted list", async () => {
  const { fireEvent } = await import("@testing-library/react");
  const stale = () =>
    view({
      phase: "unreachable",
      lines: [line("a")],
      lastSuccessAt: "2026-09-16T10:00:00.000Z",
      failure: { code: "adapter_unavailable", message: "no relay" },
    });
  const started = await mount(stale());

  fireEvent.click(started.retryButton());
  started.draw(
    view({
      phase: "unreachable",
      lines: [line("a"), line("b")],
      lastSuccessAt: "2026-09-16T10:00:00.000Z",
      failure: { code: "adapter_unavailable", message: "no relay" },
    }),
  );

  assert.equal(started.rows().length, 2);
  assert.notEqual(document.activeElement, started.rows()[0]);
});

test("moving focus off the retry button cancels the hand-off", async () => {
  const { fireEvent } = await import("@testing-library/react");
  const started = await mount(
    view({
      phase: "unreachable",
      lines: null,
      failure: { code: "adapter_unavailable", message: "no relay" },
    }),
  );

  const retry = started.retryButton();
  fireEvent.focus(retry);
  fireEvent.click(retry);
  // The operator moves focus elsewhere while the read is still in flight.
  fireEvent.blur(retry, { relatedTarget: document.body });
  started.draw(view({ phase: "ready", lines: [line("a")] }));

  assert.notEqual(document.activeElement, started.rows()[0]);
});

test("a blur with no relatedTarget — the button unmounting — keeps the hand-off", async () => {
  const { fireEvent } = await import("@testing-library/react");
  const started = await mount(
    view({
      phase: "unreachable",
      lines: null,
      failure: { code: "adapter_unavailable", message: "no relay" },
    }),
  );

  const retry = started.retryButton();
  fireEvent.focus(retry);
  fireEvent.click(retry);
  // Browsers may fire blur as the focused button leaves the document.
  fireEvent.blur(retry, { relatedTarget: null });
  started.draw(view({ phase: "ready", lines: [line("a")] }));

  assert.equal(document.activeElement, started.rows()[0]);
});
