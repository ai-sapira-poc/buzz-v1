import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PanelSection } from "./PanelSection.tsx";
import { HANDOVER_DRAWABLE_VALUES } from "./PanelRow.tsx";
import { deriveHandoverView } from "@/features/tower/ui/handoverState.ts";
import { derivePortfolioView } from "@/features/tower/ui/portfolioState.ts";
import { createTowerBuzzSource } from "@/shared/api/towerBuzzSource.ts";
import {
  KIND_JOB_ACCEPTED,
  KIND_JOB_CANCEL,
  KIND_JOB_ERROR,
  KIND_JOB_HANDOFF,
  KIND_JOB_RESULT,
} from "@/shared/constants/kinds.ts";

/**
 * P3 «Resultado del padre» — the handoff column, through the production seam:
 * the real adapter (`createTowerBuzzSource`), the real fold (`foldHandoffEdges`
 * behind `getHandovers`), the real derivations (the snapshot shape React Query
 * hands over) and the real surface (`PanelSection`).
 *
 * The two guards the design fixes as falsifiable (§6.6 and §6 criteria (a)):
 *
 * - with a healthy handoff read, no drawable value of «Resultado del padre»
 *   falls outside `done / cancelled / desconocido` (D4-3: «falló el padre» has
 *   no producer and must not be drawn);
 * - with the handoff read failed and no snapshot, the column is retired whole:
 *   the word «padre» does not appear in any cell.
 */

const OWNER = "owner-pubkey-hex";

function jobEvent({ kind, job, role = "coder", at, extraTags = [] }) {
  return {
    id: `${job}-${kind}-${at}`,
    pubkey: "agent",
    kind,
    created_at: at,
    content: "",
    sig: "sig",
    tags: [
      ["p", OWNER],
      ["h", "chan"],
      ["job", job],
      ["role", role],
      ...extraTags,
    ],
  };
}

function handoffEvent({ parent, child, at, role = "architect" }) {
  return {
    id: `${parent}->${child}-${at}`,
    pubkey: "agent",
    kind: KIND_JOB_HANDOFF,
    created_at: at,
    content: "",
    sig: "sig",
    tags: [
      ["p", OWNER],
      ["h", "chan"],
      ["job", parent],
      ["child", child],
      ["role", role],
    ],
  };
}

/** The production read with both reads injected (portfolio and handoffs). */
function sourceOver({ jobs = [], handoffs = [] }) {
  return createTowerBuzzSource(
    async () => jobs,
    async () => OWNER,
    async () => handoffs,
  );
}

/** The production read whose handoff half rejects. */
function handoffFailing(jobs, cause) {
  return createTowerBuzzSource(
    async () => jobs,
    async () => OWNER,
    async () => {
      throw cause;
    },
  );
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

function render(portfolioSnapshot, handoverSnapshot) {
  return renderToStaticMarkup(
    React.createElement(PanelSection, {
      portfolio: derivePortfolioView(portfolioSnapshot, () => {}),
      handovers: deriveHandoverView(handoverSnapshot, () => {}),
    }),
  );
}

/** The outcome value of every P3 cell, as the operator's screen reads it. */
function outcomeValues(html) {
  return [
    ...html.matchAll(/data-testid="panel-handover-outcome"[^>]*>([^<]*)</g),
  ].map((match) => match[1]);
}

/** The header and the rows — the panel's cells — without its section notices. */
function cellsMarkup(html) {
  const start = html.indexOf('data-testid="panel-list"');
  return start === -1 ? "" : html.slice(start);
}

test("D4-3: with a healthy handoff read no drawable value leaves done / cancelled / desconocido", async () => {
  // One parent per terminal kind the fold can join, plus a job with no edge.
  // `failed` is the one the guard exists for: D4-3 forbids drawing «falló el
  // padre», so it must collapse into the closed vocabulary, not add a value.
  const jobs = [
    jobEvent({ kind: KIND_JOB_ACCEPTED, job: "job-done", at: 100 }),
    jobEvent({ kind: KIND_JOB_ACCEPTED, job: "job-failed", at: 100 }),
    jobEvent({ kind: KIND_JOB_ACCEPTED, job: "job-cancelled", at: 100 }),
    jobEvent({ kind: KIND_JOB_ACCEPTED, job: "job-orphan", at: 100 }),
  ];
  const handoffs = [
    jobEvent({ kind: KIND_JOB_RESULT, job: "parent-done", at: 90 }),
    jobEvent({ kind: KIND_JOB_ERROR, job: "parent-failed", at: 90 }),
    jobEvent({ kind: KIND_JOB_CANCEL, job: "parent-cancelled", at: 90 }),
    handoffEvent({ parent: "parent-done", child: "job-done", at: 100 }),
    handoffEvent({ parent: "parent-failed", child: "job-failed", at: 100 }),
    handoffEvent({
      parent: "parent-cancelled",
      child: "job-cancelled",
      at: 100,
    }),
  ];

  const source = sourceOver({ jobs, handoffs });
  const portfolio = await source.getPortfolio();
  const rows = await source.getHandovers();
  const html = render(snapshot({ data: portfolio }), snapshot({ data: rows }));

  const values = outcomeValues(html);
  assert.ok(values.length >= 4, "every row draws one outcome value");
  for (const value of values) {
    assert.ok(
      HANDOVER_DRAWABLE_VALUES.includes(value),
      `«${value}» is not in the closed vocabulary ${HANDOVER_DRAWABLE_VALUES.join(" / ")}`,
    );
  }
  // The closed vocabulary is actually exercised: the guard would also pass on
  // a surface that drew nothing at all.
  assert.ok(values.includes("done"));
  assert.ok(values.includes("cancelled"));
  assert.ok(values.includes("desconocido"));
  // And the forbidden value is absent from the whole surface, not only the
  // annotated cell.
  assert.doesNotMatch(html, /falló el padre/i);
});

test("a failed handoff read with no snapshot retires the column; «padre» is in no cell", async () => {
  const jobs = [jobEvent({ kind: KIND_JOB_ACCEPTED, job: "job-a", at: 100 })];
  const portfolio = await sourceOver({ jobs }).getPortfolio();
  const settled = await handoffFailing(jobs, new Error("relay unreachable"))
    .getHandovers()
    .then(
      (data) => ({ data, error: null }),
      (error) => ({ data: undefined, error }),
    );
  assert.equal(settled.data, undefined, "a dead handoff read must not resolve");

  const html = render(
    snapshot({ data: portfolio }),
    snapshot({ isError: true, error: settled.error }),
  );

  // The read's own fall notice, visible — the absence of the column is not a
  // silent gap the operator has to interpret.
  assert.match(html, /No se pudo leer la fuente de relevos/);
  assert.match(html, /no se muestra: esto no significa/);
  // The whole column is gone: no header, no cell, no annotated value.
  assert.equal(outcomeValues(html).length, 0);
  assert.doesNotMatch(html, /data-testid="panel-handover-cell"/);
  assert.doesNotMatch(cellsMarkup(html), /padre/);
  // The rows themselves survive: only the handoff column was retired.
  assert.match(html, /data-testid="panel-row"/);
});

test("a failed handoff read over a snapshot keeps the column and marks it old", async () => {
  const jobs = [jobEvent({ kind: KIND_JOB_ACCEPTED, job: "job-a", at: 100 })];
  const goodHandoffs = [
    jobEvent({ kind: KIND_JOB_RESULT, job: "parent-a", at: 90 }),
    handoffEvent({ parent: "parent-a", child: "job-a", at: 100 }),
  ];
  const portfolio = await sourceOver({ jobs }).getPortfolio();
  const goodRows = await sourceOver({
    jobs,
    handoffs: goodHandoffs,
  }).getHandovers();
  const settled = await handoffFailing(jobs, new Error("timeout"))
    .getHandovers()
    .then(
      (data) => ({ data, error: null }),
      (error) => ({ data: undefined, error }),
    );

  const html = render(
    snapshot({ data: portfolio }),
    snapshot({
      isError: true,
      error: settled.error,
      data: goodRows,
      dataUpdatedAt: Date.parse("2026-09-23T09:57:00.000Z"),
    }),
  );

  assert.match(html, /La lectura de relevos falló/);
  assert.match(html, /Dato de la última lectura de relevos buena/);
  assert.deepEqual(outcomeValues(html), ["done"]);
  assert.match(html, /data-testid="panel-handover-cell"/);
  // The provenance line is inside the row cell, not only at section level.
  assert.match(html, /de las 09:57 UTC/);
});

test("a handoff edge whose parent end is unreadable still reads `desconocido`", async () => {
  // The edge exists but the parent's terminal event was not in the read: the
  // fold reports `unknown`, and the cell must draw the closed vocabulary's
  // empty — not an invented conclusion, and not "no handoff registered".
  const jobs = [jobEvent({ kind: KIND_JOB_ACCEPTED, job: "job-a", at: 100 })];
  const handoffs = [
    handoffEvent({ parent: "parent-x", child: "job-a", at: 100 }),
  ];
  const source = sourceOver({ jobs, handoffs });
  const html = render(
    snapshot({ data: await source.getPortfolio() }),
    snapshot({ data: await source.getHandovers() }),
  );

  assert.deepEqual(outcomeValues(html), ["desconocido"]);
  assert.match(html, /parent-x/);
  assert.match(html, /No hay un desenlace del padre registrado/);
});

test("a handoff read in flight says so, and never claims an absence", async () => {
  const jobs = [jobEvent({ kind: KIND_JOB_ACCEPTED, job: "job-a", at: 100 })];
  const portfolio = await sourceOver({ jobs }).getPortfolio();
  const html = render(
    snapshot({ data: portfolio }),
    snapshot({ isPending: true }),
  );

  assert.match(html, /Leyendo relevos — aún buscando, no es un vacío/);
  assert.match(html, /De qué encargo viene · resultado del padre/);
  assert.doesNotMatch(html, /sin relevo registrado/);
  assert.equal(outcomeValues(html).length, 0);
});
