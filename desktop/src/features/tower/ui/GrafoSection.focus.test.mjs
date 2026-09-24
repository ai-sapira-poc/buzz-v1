import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { JSDOM } from "jsdom";

// Spec §6 on the canvas: the section that replaced the portfolio list on Tower
// Control carries the same keyboard hand-off. The only moment it may move focus
// is after the operator's own Retry resolves into cards. A loading → data
// transition must not steal focus, the stale-banner Retry (which leaves the
// canvas mounted) must not pull focus out of wherever the operator left it, and
// moving focus off the retry button while the read is in flight cancels the
// hand-off. react-dom/server cannot exercise focus, so this file mounts into
// jsdom like the list keyboard test. Queries are scoped to the container:
// renders are not torn down between tests, so a document-wide query would match
// a previous test's tree.
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
  const { GrafoSection } = await import("./GrafoSection.tsx");
  const result = render(
    React.createElement(GrafoSection, { view: portfolioView }),
  );
  return {
    ...result,
    draw: (next) =>
      result.rerender(React.createElement(GrafoSection, { view: next })),
    cards: () =>
      result.container.querySelectorAll('[data-testid="tower-node"]'),
    retryButton: () => result.container.querySelector("button"),
  };
}

test("a resolved Retry hands focus to the first card on the canvas", async () => {
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

  const cards = started.cards();
  assert.equal(cards.length, 2);
  assert.equal(document.activeElement, cards[0]);
});

test("a plain loading to data transition does not steal focus", async () => {
  const started = await mount(view({ phase: "loading", lines: null }));
  started.draw(view({ phase: "ready", lines: [line("a")] }));

  const cards = started.cards();
  assert.equal(cards.length, 1);
  assert.notEqual(document.activeElement, cards[0]);
});

test("the stale-banner Retry does not pull focus into the already-mounted canvas", async () => {
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

  assert.equal(started.cards().length, 2);
  assert.notEqual(document.activeElement, started.cards()[0]);
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

  assert.notEqual(document.activeElement, started.cards()[0]);
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

  assert.equal(document.activeElement, started.cards()[0]);
});
