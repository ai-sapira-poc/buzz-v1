import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PanelSection } from "./PanelSection.tsx";
import { deriveHandoverView } from "@/features/tower/ui/handoverState";
import { derivePortfolioView } from "@/features/tower/ui/portfolioState";

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

function line(overrides = {}) {
  return {
    project: { id: "job-a", name: "coder" },
    recency: { lastSpanAt: new Date(100 * 1000).toISOString() },
    blocked: { count: 0, basis: null },
    cost: null,
    work: { state: "running", summary: "escribiendo el slice" },
    waiting: null,
    ...overrides,
  };
}

function render({ portfolio, handovers = snapshot({ data: [] }) }) {
  return renderToStaticMarkup(
    React.createElement(PanelSection, {
      portfolio: derivePortfolioView(portfolio, () => {}),
      handovers: deriveHandoverView(handovers, () => {}),
    }),
  );
}

test("loading keeps the six-column header and never claims a wait", () => {
  const html = render({ portfolio: snapshot({ isPending: true }) });
  assert.match(html, /Quién/);
  assert.match(html, /Hilo/);
  assert.doesNotMatch(html, /Sin señal/);
});

test("F4: the loading state says it is reading, in text that is not sr-only", () => {
  // The contract §4 loading literal, carried by the surface itself: before this
  // it lived only in `panel-status-announcement`'s `<p className="sr-only">`, so
  // the operator saw five skeleton rows and no words (gate 3%).
  const html = render({ portfolio: snapshot({ isPending: true }) });
  const carrier = html.match(
    /<p[^>]*data-testid="panel-loading-text"[^>]*>([\s\S]*?)<\/p>/,
  );
  assert.ok(carrier, "the loading line must be carried by its own element");
  assert.doesNotMatch(carrier[0], /sr-only/);
  assert.match(carrier[1], /Leyendo — aún buscando, no es un vacío/);
  // The six-column header the product decision keeps visible (D-8) is still
  // there, next to the words.
  assert.match(html, /Quién/);
});

test("an empty read names the window and says it is not a read failure", () => {
  const html = render({ portfolio: snapshot({ data: [] }) });
  assert.match(html, /No hay encargos en este periodo/);
  assert.match(html, /no es un fallo de lectura/);
});

test("a failed read is drawn as an error, never as empty", () => {
  const html = render({
    portfolio: snapshot({
      isError: true,
      data: undefined,
      error: new Error("timeout"),
    }),
  });
  assert.match(html, /No se pudo leer el registro de encargos/);
  assert.match(html, /timeout/);
  assert.doesNotMatch(html, /No hay encargos en este periodo/);
});

test("a failed read with previous rows keeps them under a stale banner", () => {
  const html = render({
    portfolio: snapshot({
      isError: true,
      data: [line()],
      error: new Error("x"),
    }),
  });
  assert.match(html, /La lectura de encargos falló/);
  assert.match(html, /datos viejos, no actuales/);
  assert.match(html, /escribiendo el slice/);
  assert.doesNotMatch(html, /data-testid="panel-error-state"/);
});

test("a recorded wait names its reason and instant", () => {
  const html = render({
    portfolio: snapshot({
      data: [
        line({
          waiting: {
            reason: "ladder_exhausted",
            at: "2026-09-23T09:40:00.000Z",
          },
        }),
      ],
    }),
  });
  assert.match(html, /Espera registrada/);
  assert.match(html, /ladder_exhausted/);
  assert.match(html, /ladder automático se agotó/);
});

test("an absent wait says sin señal and says it is not nothing", () => {
  const html = render({ portfolio: snapshot({ data: [line()] }) });
  assert.match(html, /Sin señal/);
  assert.match(html, /Esto no significa que nada espere/);
});

test("the panel never renders a blocked cell or a bare zero", () => {
  const html = render({
    portfolio: snapshot({
      data: [line({ blocked: { count: 1, basis: "observed" } })],
    }),
  });
  assert.doesNotMatch(html, /blocked/i);
  assert.doesNotMatch(html, /0 blocked/);
});

test("a job with no parent says so in words", () => {
  const html = render({ portfolio: snapshot({ data: [line()] }) });
  assert.match(html, /sin padre registrado/);
  assert.match(html, /sin resultado registrado/);
  assert.match(html, /sin hilo/);
});

test("a missing task is named, never left blank", () => {
  const html = render({
    portfolio: snapshot({
      data: [line({ work: { state: "running", summary: null } })],
    }),
  });
  assert.match(html, /sin tarea declarada/);
});

// §7 case 5: a wait whose job published no lifecycle event in the window —
// born of a relay-error publication that leaves the wait with no job around
// it — is reported, not discarded, and not drawn as an ordinary wait.
test("an orphan wait is reported as a wait with no activity in the window", () => {
  const html = render({
    portfolio: snapshot({
      data: [
        line({
          work: null,
          recency: { lastSpanAt: "2026-09-23T09:40:00.000Z" },
          waiting: {
            reason: "capability_denied",
            at: "2026-09-23T09:40:00.000Z",
          },
        }),
      ],
    }),
  });
  assert.match(
    html,
    /Espera registrada para un encargo sin actividad en la ventana/,
  );
});

test("an ordinary wait of an active job does not claim the orphan sentence", () => {
  const html = render({
    portfolio: snapshot({
      data: [
        line({
          work: { state: "running", summary: "escribiendo el slice" },
          waiting: {
            reason: "capability_denied",
            at: "2026-09-23T09:40:00.000Z",
          },
        }),
      ],
    }),
  });
  assert.match(html, /Espera registrada/);
  assert.doesNotMatch(html, /sin actividad en la ventana/);
});
