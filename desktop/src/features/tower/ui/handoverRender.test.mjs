import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createTowerBuzzSource } from "@/shared/api/towerBuzzSource";
import { HandoverSection } from "./HandoverSection.tsx";
import { deriveHandoverView } from "./handoverState.ts";

/**
 * End-to-end through the port: the real Buzz adapter reads handoff edges, and
 * the section renders them. This binds the adapter → domain → view seams so a
 * break in any one of them fails here, not only in the unit tests.
 */
function handoffEvent({ parent, child, role = "builder", at = 100 }) {
  return {
    id: `${parent}-${child}-${at}`,
    pubkey: "agent",
    kind: 43007,
    created_at: at,
    content: "",
    sig: "sig",
    tags: [
      ["p", "owner"],
      ["h", "chan-1"],
      ["job", parent],
      ["child", child],
      ["role", role],
    ],
  };
}

function lifecycleEvent({ kind, job, at, role }) {
  return {
    id: `${job}-${kind}-${at}`,
    pubkey: "agent",
    kind,
    created_at: at,
    content: "",
    sig: "sig",
    tags: [
      ["p", "owner"],
      ["job", job],
      ...(role === undefined ? [] : [["role", role]]),
    ],
  };
}

function snapshot(overrides) {
  return {
    isPending: false,
    isFetching: false,
    isError: false,
    data: undefined,
    dataUpdatedAt: 0,
    error: null,
    ...overrides,
  };
}

function sourceOver(events) {
  return createTowerBuzzSource(
    async () => [],
    async () => "owner",
    async () => events,
  );
}

test("real handoff edges render as rows, not as empty or error", async () => {
  const source = sourceOver([
    lifecycleEvent({ kind: 43004, job: "tower-architect", at: 90 }),
    handoffEvent({
      parent: "tower-architect",
      child: "tower-coder",
      role: "architect",
      at: 100,
    }),
  ]);

  const rows = await source.getHandovers();
  const markup = renderToStaticMarkup(
    React.createElement(HandoverSection, {
      view: deriveHandoverView(snapshot({ data: rows }), () => {}),
    }),
  );

  assert.match(markup, /architect/);
  assert.match(markup, /tower-coder/);
  assert.match(markup, /terminó/);
  assert.match(markup, /chan-1/);
  assert.doesNotMatch(markup, /tower-handover-empty/);
  assert.doesNotMatch(markup, /tower-handover-error/);
});

test("a successful empty read renders the empty state, not the error state", async () => {
  const rows = await sourceOver([]).getHandovers();
  assert.deepEqual(rows, []);
  const markup = renderToStaticMarkup(
    React.createElement(HandoverSection, {
      view: deriveHandoverView(snapshot({ data: rows }), () => {}),
    }),
  );
  assert.match(markup, /No hay ningún relevo en esta ventana/);
  assert.doesNotMatch(markup, /tower-handover-error/);
});

test("a failed read renders the error state, not the empty state", async () => {
  const source = createTowerBuzzSource(
    async () => [],
    async () => "owner",
    async () => {
      throw new Error("relay unreachable");
    },
  );
  const settled = await source.getHandovers().then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  assert.equal(settled.value, undefined, "a dead source must not resolve");

  const markup = renderToStaticMarkup(
    React.createElement(HandoverSection, {
      view: deriveHandoverView(
        snapshot({ isError: true, error: settled.error }),
        () => {},
      ),
    }),
  );
  assert.match(markup, /No se pudo leer el registro de relevos/);
  assert.match(markup, /adapter_unavailable/);
  assert.doesNotMatch(markup, /No hay ningún relevo en esta ventana/);
});

test("loading renders a skeleton, never the empty state's copy", () => {
  const markup = renderToStaticMarkup(
    React.createElement(HandoverSection, {
      view: deriveHandoverView(snapshot({ isPending: true }), () => {}),
    }),
  );
  assert.match(markup, /tower-handover-loading/);
  // The loading branch carries its own visible line: a bare skeleton is
  // indistinguishable from a section that never loaded.
  assert.match(markup, /Leyendo los relevos/);
  assert.doesNotMatch(markup, /No hay ningún relevo en esta ventana/);
  assert.doesNotMatch(markup, /tower-handover-error/);
});

test("a failure over a previous empty read keeps the failure visible", () => {
  // R6: the last successful read returned no rows, and the next read failed.
  // The section must not render as a plain empty state — the failure is
  // announced above the old (empty) snapshot.
  const markup = renderToStaticMarkup(
    React.createElement(HandoverSection, {
      view: deriveHandoverView(
        snapshot({
          isError: true,
          error: new Error("relay unreachable"),
          data: [],
        }),
        () => {},
      ),
    }),
  );
  assert.match(markup, /tower-handover-stale/);
  assert.doesNotMatch(markup, /tower-handover-error/);
});

test("a failure over previous rows keeps the rows and names them stale", async () => {
  const source = sourceOver([
    handoffEvent({ parent: "tower-architect", child: "tower-coder", at: 100 }),
  ]);
  const rows = await source.getHandovers();
  const markup = renderToStaticMarkup(
    React.createElement(HandoverSection, {
      view: deriveHandoverView(
        snapshot({
          isError: true,
          error: new Error("relay unreachable"),
          data: rows,
        }),
        () => {},
      ),
    }),
  );
  assert.match(markup, /tower-handover-stale/);
  assert.match(markup, /tower-coder/);
});

test("the receiver cell names the child's own role, joined from its events", async () => {
  const source = sourceOver([
    lifecycleEvent({ kind: 43002, job: "tower-r2", at: 80, role: "reviewer" }),
    handoffEvent({ parent: "tower-architect", child: "tower-r2", at: 100 }),
  ]);
  const rows = await source.getHandovers();
  const markup = renderToStaticMarkup(
    React.createElement(HandoverSection, {
      view: deriveHandoverView(snapshot({ data: rows }), () => {}),
    }),
  );
  // The child's role is not the emitter's role, and the job id alone cannot
  // supply it ("tower-r2" contains no role name).
  assert.match(markup, /reviewer/);
  assert.doesNotMatch(markup, /Rol sin registrar/);
  assert.match(markup, /builder/);
});
