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
 * El par que el corte existe para separar en la superficie:
 *
 * - la fuente **rechaza** sin snapshot previo → frase de caída con motivo, y
 *   «Sin señal de espera registrada» **ausente del DOM**: una caída no se dibuja
 *   como vacío;
 * - la fuente **responde** sin `43008` → la celda «Espera» dice «Sin señal…», y
 *   el aviso de caída **no está**.
 *
 * Los dos casos emparejados se comprueban con asertos de ausencia cruzados: es
 * lo que hace falsable el par (una prueba que solo mirase el caso caído pasaría
 * también si la celda mintiera).
 *
 * Alcance de lo que este fichero ata, dicho para no sobreestimarlo: el
 * adaptador se conduce con las **lecturas inyectadas**, así que la costura
 * «rechazo vs. lista vacía» del propio `towerBuzzSource.ts` la ata
 * `towerBuzzSource.test.mjs`; mutar esa línea no pone rojo a este fichero. Lo
 * que aquí se ata es la superficie: que la caída y el vacío sano no se
 * dibujen el uno como el otro, con la derivación y el render reales.
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
  // The pair's other half: a healthy read draws no provenance line — the line
  // belongs to the fall (deliberately rejected mutation: hand it to a ready
  // read and this goes red).
  assert.doesNotMatch(html, /Dato de la última lectura buena/);
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
  // The other half of the cell's pair: a healthy read announces no provenance.
  assert.doesNotMatch(html, /Dato de la última lectura buena/);
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
  // The notice says the rows are old, and says *when* the good read happened
  // — as the same HH:MM UTC the row's provenance line prints (F3).
  assert.match(html, /La lectura de encargos falló/);
  assert.match(html, /datos viejos, no actuales/);
  assert.match(html, /Se muestra la última lectura buena, de 09:40 UTC\./);
  assert.match(html, /adapter_unavailable/);
  assert.doesNotMatch(html, /data-testid="panel-error-state"/);
});

test("F1: a fall over an empty snapshot never claims the source answered", async () => {
  // The preserved snapshot was a *successful* empty read; the refetch then
  // dies. The stale banner says the read failed — and, before the fix, the
  // empty state's copy said the source had answered, right below it. Both on
  // screen at once is a contradiction: the banner cannot promise rows and the
  // empty state cannot assert an answer.
  const empty = await viewFrom(sourceOver([]));
  const portfolio = await viewFrom(failingSource(new Error("timeout")), {
    previous: empty.lines,
    dataUpdatedAt: Date.parse("2026-09-23T09:40:00.000Z"),
  });
  const html = render(portfolio);

  assert.equal(portfolio.phase, "unreachable");
  assert.match(html, /La lectura de encargos falló/);
  // The two claims a fall withholds: that the source answered, and «sin señal».
  assert.doesNotMatch(html, /no es un fallo de lectura/);
  assert.doesNotMatch(html, /No hay encargos en este periodo/);
  assert.doesNotMatch(html, /Sin señal de espera registrada/);
  // What it actually knows: the last good read was empty, and now it is stale.
  assert.match(html, /no encontró encargos/);
  assert.doesNotMatch(html, /Las filas de abajo son datos viejos/);
  // The spoken line cannot announce rows the screen is not drawing (rejected
  // mutation: drop the `rows.length === 0` branch of `announcementFor` and this
  // goes red while the screen stays right — the two would disagree silently).
  assert.doesNotMatch(html, /se muestran datos viejos/);
  assert.match(html, /la última lectura buena no encontró encargos/);
  // The prior read *succeeded* — it answered with nothing. "volvió a fallar"
  // would claim it had failed, which is not what the snapshot says.
  assert.doesNotMatch(html, /volvió a fallar/);
});

test("F2: a fall with rows on screen marks the wait cell's value as old, never bare", async () => {
  // The read kept a snapshot with one encargo and no `43008`, then failed. The
  // rows stay on screen (D-9), so the wait cell is on screen over a read that
  // never answered — its value must travel with the provenance line design
  // §2.4 (rama B) fixes for it, the remedy the r1 verdict ratified.
  const good = await viewFrom(
    sourceOver([jobEvent({ kind: KIND_JOB_ACCEPTED, job: "job-a", at: 100 })]),
  );
  const portfolio = await viewFrom(failingSource(new Error("timeout")), {
    previous: good.lines,
    dataUpdatedAt: Date.parse("2026-09-23T09:40:00.000Z"),
  });
  const html = render(portfolio);

  assert.equal(portfolio.phase, "unreachable");
  assert.match(html, /data-testid="panel-list"/);
  assert.match(html, /La lectura de encargos falló/);
  // The ratified literal, whole: the snapshot's value, then the line that marks
  // it old with the hour of its own read.
  assert.match(
    html,
    /Dato de la última lectura buena, de las 09:40 UTC\. La lectura actual falló: esto es un dato viejo, no actual\./,
  );
  // The healthy empty's caveat is a claim about *now*, and a failed read
  // withholds it — without this the bare «sin señal» could pass for the healthy
  // state (deliberately rejected mutation: drop the provenance line and only
  // this assertion stays silent, so the caveat check is what names the lie).
  assert.doesNotMatch(html, /esto no significa que nada espere/);
});

test("F2: a fall with a recorded wait marks that wait's value as old too", async () => {
  // The cell's other shape, and design §2.4 rama B covers both. The preserved
  // snapshot *did* carry a wait, so the cell draws «Espera registrada» and its
  // «Desde <instante>» — text that reads as a wait happening *now*. Without the
  // provenance line this branch carries the same lie F2 closes for the empty
  // one, and no other test binds it (measured: removing the line from this
  // branch alone leaves the whole panel glob green).
  const good = await viewFrom(
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
  const portfolio = await viewFrom(failingSource(new Error("timeout")), {
    previous: good.lines,
    dataUpdatedAt: Date.parse("2026-09-23T09:40:00.000Z"),
  });
  const html = render(portfolio);

  assert.equal(portfolio.phase, "unreachable");
  // The wait itself is kept — D-9 keeps the rows, and a wait that really
  // happened is worth more than a blank cell.
  assert.match(html, /Espera registrada/);
  assert.match(html, /ladder_exhausted/);
  // And it travels marked as old, with the hour of the read it came from.
  assert.match(
    html,
    /Dato de la última lectura buena, de las 09:40 UTC\. La lectura actual falló: esto es un dato viejo, no actual\./,
  );
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

test("F3: the fall notice names the hour as HH:MM UTC in both of its branches", async () => {
  // One hour, one format. The row's provenance line prints `HH:MM` UTC by
  // design §2.4; the notice printed the raw ISO (`2026-09-23T09:40:00.000Z`),
  // so one screen read the same instant two ways (deliberately rejected
  // mutation: hand `lastSuccessAt` to the notice unformatted, and this test and
  // the notice's own test above go red while the rest of the glob stays green).
  const readAt = Date.parse("2026-09-23T09:40:00.000Z");
  const rawIso = /2026-09-23T09:40:00\.000Z/;

  // Branch with rows: the preserved snapshot held one encargo.
  const good = await viewFrom(
    sourceOver([jobEvent({ kind: KIND_JOB_ACCEPTED, job: "job-a", at: 100 })]),
  );
  const withRows = render(
    await viewFrom(failingSource(new Error("timeout")), {
      previous: good.lines,
      dataUpdatedAt: readAt,
    }),
  );
  assert.match(withRows, /Se muestra la última lectura buena, de 09:40 UTC\./);
  // The row's own `Instante` cell carries the event's raw ISO on purpose; the
  // read's instant is not the event's, so it appears nowhere as the ISO.
  assert.doesNotMatch(withRows, rawIso);

  // Branch whose last good read answered with nothing: same hour, same format.
  const empty = await viewFrom(sourceOver([]));
  const wasEmpty = render(
    await viewFrom(failingSource(new Error("timeout")), {
      previous: empty.lines,
      dataUpdatedAt: readAt,
    }),
  );
  assert.match(
    wasEmpty,
    /La última lectura buena, de 09:40 UTC, no encontró encargos\./,
  );
  assert.doesNotMatch(wasEmpty, rawIso);
});
