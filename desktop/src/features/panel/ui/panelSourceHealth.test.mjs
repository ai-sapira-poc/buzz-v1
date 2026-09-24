import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PanelSection } from "./PanelSection.tsx";
import { TowerSourceError } from "@/features/tower/domain/TowerSource.ts";
import { createTowerBuzzSource } from "@/shared/api/towerBuzzSource.ts";
import {
  KIND_JOB_ACCEPTED,
  KIND_JOB_WAITING,
} from "@/shared/constants/kinds.ts";
import { deriveHandoverView } from "@/features/tower/ui/handoverState.ts";
import { derivePortfolioView } from "@/features/tower/ui/portfolioState.ts";

/**
 * La prueba de par obligatoria de S3 §5.1, atada a la costura de producción:
 * el adaptador **real** (`createTowerBuzzSource`, con las lecturas inyectadas),
 * la derivación **real** (`derivePortfolioView`, con la forma de snapshot que
 * React Query entrega) y la superficie **real** (`PanelSection`).
 *
 * El par que el corte existe para separar — y que `events ?? []` fundía en uno
 * solo:
 *
 * - la fuente **rechaza** → frase de caída con motivo, y «Sin señal de espera
 *   registrada» **ausente del DOM**: una caída no se dibuja como vacío;
 * - la fuente **responde** sin `43008` → la celda «Espera» dice «Sin señal…», y
 *   el aviso de caída **no está**.
 *
 * Los dos casos emparejados se comprueban con asertos de ausencia cruzados: es
 * lo que hace falsable el par (una prueba que solo mirase el caso caído pasaría
 * también si la celda mintiera).
 */

const OWNER = "owner-pubkey-hex";

/** A raw job event, as the relay returns it. */
function jobEvent({
  kind,
  job,
  role = "coder",
  at,
  content = "",
  extraTags = [],
}) {
  return {
    id: `${job}-${kind}-${at}`,
    pubkey: "agent",
    kind,
    created_at: at,
    content,
    sig: "sig",
    tags: [
      ["p", OWNER],
      ["h", "channel-uuid"],
      ["job", job],
      ["role", role],
      ...extraTags,
    ],
  };
}

/** The production read over fixed events. */
function sourceOver(events) {
  return createTowerBuzzSource(
    async () => events,
    async () => OWNER,
  );
}

/** The production read that dies, over a fixed cause. */
function failingSource(cause) {
  return createTowerBuzzSource(
    async () => {
      throw cause;
    },
    async () => OWNER,
  );
}

/**
 * Drives the settled adapter result through the same derivation the screen
 * uses. `previous`/`dataUpdatedAt` are what React Query still holds from an
 * earlier read when a refetch fails.
 */
async function viewFrom(source, { previous, dataUpdatedAt = 0 } = {}) {
  const settled = await source.getPortfolio().then(
    (data) => ({ data, cause: null }),
    (cause) => ({ data: undefined, cause }),
  );
  return derivePortfolioView(
    {
      isPending: false,
      isFetching: false,
      isError: settled.cause !== null,
      data: settled.data ?? previous,
      dataUpdatedAt,
      error: settled.cause,
    },
    () => {},
  );
}

/** The handoff read answered and found nothing: this test is not about it. */
function quietHandovers() {
  return deriveHandoverView(
    {
      isPending: false,
      isFetching: false,
      isError: false,
      data: [],
      dataUpdatedAt: 0,
      error: null,
    },
    () => {},
  );
}

function render(portfolio) {
  return renderToStaticMarkup(
    React.createElement(PanelSection, {
      portfolio,
      handovers: quietHandovers(),
    }),
  );
}

const NO_WAIT_SENTENCE =
  /Sin señal de espera registrada\. Esto no significa que nada espere\./;

test("pair: a rejected read is the fall notice and never «sin señal»", async () => {
  // The port's contract is a rejection that *rises*; the adapter's job is to
  // keep it a rejection, so the surface can tell it from a successful empty
  // read. Driving the adapter, not a hand-built portfolio line.
  const portfolio = await viewFrom(
    failingSource(new Error("relay unreachable")),
  );
  const html = render(portfolio);

  assert.equal(portfolio.phase, "unreachable");
  assert.match(html, /No se pudo leer el registro de encargos/);
  assert.match(html, /Motivo:/);
  // The adapter's own translated message, and the code the port carries — not
  // the raw throw the transport produced.
  assert.match(html, /Could not read agent work from the relay\./);
  assert.match(html, /adapter_unavailable/);
  // The lie the cut exists to stop: a dead read borrowing the wait cell's
  // meaning, or the empty state's.
  assert.doesNotMatch(html, /Sin señal de espera registrada/);
  assert.doesNotMatch(html, /No hay encargos en este periodo/);
  // R5+R7: no figure travels under a fall.
  assert.doesNotMatch(html, /data-testid="panel-list"/);
});

test("pair: a healthy read with no wait event says «sin señal», with no fall notice", async () => {
  // The read answered. It holds one job and no `43008` — the state the panel
  // spends most of its life in, because the wait producer is best-effort.
  const portfolio = await viewFrom(
    sourceOver([jobEvent({ kind: KIND_JOB_ACCEPTED, job: "job-a", at: 100 })]),
  );
  const html = render(portfolio);

  assert.equal(portfolio.phase, "ready");
  assert.match(html, NO_WAIT_SENTENCE);
  assert.doesNotMatch(html, /No se pudo leer el registro de encargos/);
  assert.doesNotMatch(html, /La lectura de encargos falló/);
  assert.doesNotMatch(html, /datos viejos/);
});

test("pair: a wait event read normally still names its reason, and is not a fall", async () => {
  const portfolio = await viewFrom(
    sourceOver([
      jobEvent({ kind: KIND_JOB_ACCEPTED, job: "job-a", at: 100 }),
      jobEvent({
        kind: KIND_JOB_WAITING,
        job: "job-a",
        at: 120,
        extraTags: [["reason", "ladder_exhausted"]],
      }),
    ]),
  );
  const html = render(portfolio);

  assert.match(html, /Espera registrada/);
  assert.match(html, /ladder_exhausted/);
  assert.doesNotMatch(html, /Sin señal de espera registrada/);
  assert.doesNotMatch(html, /No se pudo leer el registro de encargos/);
});

test("pair: a read that answers with nothing at all is the empty state, not a fall", async () => {
  // Belt and braces on the literal reading of «la fuente resuelve `[]`»: the
  // *whole* read empty is the empty state, and there is no row — so no wait
  // cell exists to claim «sin señal». The assertion that matters is that this
  // is not drawn as a failure.
  const portfolio = await viewFrom(sourceOver([]));
  const html = render(portfolio);

  assert.equal(portfolio.phase, "ready");
  assert.match(html, /No hay encargos en este periodo/);
  assert.doesNotMatch(html, /No se pudo leer el registro de encargos/);
  assert.doesNotMatch(html, /Sin señal de espera registrada/);
});

test("a rejection after a good read keeps the rows and names the instant", async () => {
  const good = await viewFrom(
    sourceOver([
      jobEvent({
        kind: KIND_JOB_ACCEPTED,
        job: "job-a",
        at: 100,
        content: "escribiendo el slice",
      }),
    ]),
  );
  const readAt = Date.parse("2026-09-23T09:40:00.000Z");
  const portfolio = await viewFrom(failingSource(new Error("timeout")), {
    previous: good.lines,
    dataUpdatedAt: readAt,
  });
  const html = render(portfolio);

  assert.equal(portfolio.phase, "unreachable");
  // The list is not unmounted under a fall (D-9).
  assert.match(html, /escribiendo el slice/);
  assert.match(html, /data-testid="panel-list"/);
  // The notice says the rows are old, and says *when* the good read happened.
  assert.match(html, /La lectura de encargos falló/);
  assert.match(html, /datos viejos, no actuales/);
  assert.match(html, /2026-09-23T09:40:00\.000Z/);
  assert.match(html, /adapter_unavailable/);
  assert.doesNotMatch(html, /data-testid="panel-error-state"/);
});

test("the notice quotes the port's code, and coins none when the port gave none", async () => {
  // Half one: a port failure that carries a citable code puts it in the DOM.
  const coded = render(
    derivePortfolioView(
      {
        isPending: false,
        isFetching: false,
        isError: true,
        data: undefined,
        dataUpdatedAt: 0,
        error: new TowerSourceError(
          "adapter_unavailable",
          "Could not read agent work from the relay.",
        ),
      },
      () => {},
    ),
  );
  assert.match(coded, /code: adapter_unavailable/);

  // Half two: an error with no code — reachable through the port with any other
  // `TowerSource` — shows its message and *not* a code invented for it.
  const uncoded = derivePortfolioView(
    {
      isPending: false,
      isFetching: false,
      isError: true,
      data: undefined,
      dataUpdatedAt: 0,
      error: new Error("the reader said nothing useful"),
    },
    () => {},
  );
  const html = render(uncoded);

  assert.equal(uncoded.failure.code, null);
  assert.match(html, /the reader said nothing useful/);
  assert.doesNotMatch(html, /code:/);
  assert.doesNotMatch(html, /adapter_unavailable/);
});

test("neither fall notice is dismissible, and each carries exactly one retry", async () => {
  const bare = render(await viewFrom(failingSource(new Error("x"))));
  const withSnapshot = render(
    await viewFrom(failingSource(new Error("x")), {
      previous: (await viewFrom(sourceOver([]))).lines,
      dataUpdatedAt: 1,
    }),
  );

  for (const html of [bare, withSnapshot]) {
    assert.equal(
      (html.match(/<button/g) ?? []).length,
      1,
      "the fall notice must offer exactly one action: the retry",
    );
    assert.match(html, /Reintentar lectura/);
    assert.doesNotMatch(html, /aria-label="[^"]*[Cc]errar/);
    assert.doesNotMatch(html, /aria-label="[^"]*[Dd]escartar/);
  }
});
