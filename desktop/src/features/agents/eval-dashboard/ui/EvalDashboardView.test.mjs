/**
 * I2 acceptance criteria (`PLANS/PLAN_SUITE_EVALS_UI_RENDIMIENTO.md`):
 *
 *  - With today's real data shape (N agent folders): N cards, no error, and
 *    the header summary matches an independent recount of the same payload.
 *  - An empty folder created by hand renders "sin casos aún" and stays in
 *    the listing (never disappears for having incomplete data).
 *  - A missing/unreadable root (`list_agent_eval_summaries` returns `[]`,
 *    same contract as `read_agent_evals` for a missing directory) renders
 *    an explained empty state, not a blank screen or a crash.
 *
 * I4 acceptance criterion: pressing manual refresh re-reads the listing
 * (a folder created by hand appears, a folder removed by hand disappears)
 * without remounting the view — i.e. via `refetch()` on the existing query,
 * not a full-page reload.
 *
 * The Tauri IPC bridge is stubbed at globalThis.__TAURI_INTERNALS__.invoke,
 * same pattern as acpRuntimesQuery.test.mjs and
 * UnifiedAgentsSectionCardTarget.test.mjs.
 */

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

const clients = [];
let listAgentEvalSummariesHandler = () => Promise.resolve([]);

let act;
let cleanup;
let render;
let screen;
let fireEvent;
let createElement;
let QueryClient;
let QueryClientProvider;
let RouterContextProvider;
let router;
let EvalDashboardView;

before(async () => {
  Object.assign(globalThis, {
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    self: dom.window,
    window: dom.window,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
    writable: true,
  });
  dom.window.__TAURI_INTERNALS__ = {
    invoke: (command) => {
      if (command === "list_agent_eval_summaries") {
        return listAgentEvalSummariesHandler();
      }
      return Promise.reject(new Error(`unmocked Tauri command: ${command}`));
    },
    transformCallback: () => Math.random(),
  };

  ({ act, cleanup, render, screen, fireEvent } = await import(
    "@testing-library/react"
  ));
  ({ createElement } = await import("react"));
  ({ QueryClient, QueryClientProvider } = await import(
    "@tanstack/react-query"
  ));
  const {
    RouterContextProvider: RouterCtx,
    createMemoryHistory,
    createRootRoute,
    createRouter,
  } = await import("@tanstack/react-router");
  RouterContextProvider = RouterCtx;
  // A minimal in-memory router, same pattern as
  // `inboxReopenNavigation.test.mjs`: I3's case detail renders case
  // input/expected through `Markdown`, which reads router context
  // (`useAppNavigation`) even though nothing here navigates.
  const rootRoute = createRootRoute();
  router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  ({ EvalDashboardView } = await import("./EvalDashboardView.tsx"));
});

afterEach(() => {
  cleanup?.();
  for (const client of clients.splice(0)) {
    client.cancelQueries();
    client.clear();
  }
  listAgentEvalSummariesHandler = () => Promise.resolve([]);
});

after(() => dom.window.close());

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  return render(
    createElement(
      RouterContextProvider,
      { router },
      createElement(
        QueryClientProvider,
        { client },
        createElement(EvalDashboardView),
      ),
    ),
  );
}

/** Minimal but real-shaped `AgentEvalSummary` (matches `contract.rs`'s
 * `#[serde(flatten)]` wire shape: `AgentEvals` fields alongside `dirName`). */
function agentEvalSummary(overrides = {}) {
  return {
    dirName: "agent",
    dir: "/nest/.agents/evals/agent",
    exists: true,
    cases: [],
    feedback: [],
    bulletin: null,
    discrepancies: [],
    ...overrides,
  };
}

function evalCase(overrides = {}) {
  return {
    number: 1,
    title: "Caso",
    origin: "nacimiento",
    date: "2026-08-20",
    author: "guillermo",
    input: "i",
    expected: "o",
    fileName: "caso-01.md",
    problems: [],
    ...overrides,
  };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

test("EvalDashboardView_realShapedData_rendersOneCardPerFolderWithMatchingSummary", async () => {
  // 12 folders, mirroring the real `~/.buzz-dev/.agents/evals/` shape the PRD
  // criterion is stated against: 3 with a bulletin (one `baja`), the rest
  // with cases but no bulletin, one with no cases and no bulletin at all.
  const summaries = [
    agentEvalSummary({
      dirName: "agent-builder",
      cases: [],
    }),
    agentEvalSummary({
      dirName: "ana-soporte",
      cases: [evalCase(), evalCase({ number: 2, origin: "feedback" })],
      bulletin: {
        date: "2026-08-29",
        runner: "manual",
        score: "0.75",
        trend: "sube",
        rows: [],
        problems: [],
      },
    }),
    agentEvalSummary({
      dirName: "delivery-lead",
      cases: [evalCase(), evalCase({ number: 2 }), evalCase({ number: 3 })],
    }),
    agentEvalSummary({
      dirName: "designer",
      cases: [evalCase(), evalCase({ number: 2 })],
    }),
    agentEvalSummary({
      dirName: "engineer",
      cases: [evalCase(), evalCase({ number: 2 })],
    }),
    agentEvalSummary({
      dirName: "eval-runner",
      cases: [evalCase(), evalCase({ number: 2 })],
    }),
    agentEvalSummary({
      dirName: "evals",
      cases: [evalCase(), evalCase({ number: 2 })],
    }),
    agentEvalSummary({
      dirName: "pm",
      cases: [evalCase(), evalCase({ number: 2 }), evalCase({ number: 3 })],
      bulletin: {
        date: "2026-08-30",
        runner: "manual",
        score: "0.60",
        trend: "baja",
        rows: [],
        problems: [],
      },
    }),
    agentEvalSummary({
      dirName: "product-lead",
      cases: [evalCase(), evalCase({ number: 2 })],
    }),
    agentEvalSummary({
      dirName: "qa-engineer",
      cases: [evalCase(), evalCase({ number: 2 })],
    }),
    agentEvalSummary({
      dirName: "reviewer",
      cases: [evalCase(), evalCase({ number: 2 })],
    }),
    agentEvalSummary({
      dirName: "texter",
      cases: [evalCase(), evalCase({ number: 2 })],
      bulletin: {
        date: "2026-08-30",
        runner: "manual",
        score: "0.85",
        trend: "estable",
        rows: [],
        problems: [],
      },
    }),
  ];
  listAgentEvalSummariesHandler = () => Promise.resolve(summaries);

  await act(async () => {
    renderView();
  });
  await settle();

  const cards = screen.getAllByTestId("agent-eval-card");
  assert.equal(cards.length, 12, "one card per folder, no errors");

  // Header summary matches an INDEPENDENT recount of the same payload taken
  // right now, not a value copied from the fixture above.
  const expectedAgents = summaries.length;
  const expectedCases = summaries.reduce((n, s) => n + s.cases.length, 0);
  const expectedRegressions = summaries.filter(
    (s) => s.bulletin?.trend === "baja",
  ).length;

  assert.equal(
    screen.getByTestId("eval-dashboard-summary-agents").textContent,
    String(expectedAgents),
  );
  assert.equal(
    screen.getByTestId("eval-dashboard-summary-cases").textContent,
    String(expectedCases),
  );
  assert.equal(
    screen.getByTestId("eval-dashboard-summary-regressions").textContent,
    String(expectedRegressions),
  );
  assert.equal(expectedRegressions, 1, "only pm's bulletin is baja");

  assert.equal(screen.queryByTestId("eval-dashboard-error"), null);
  assert.equal(screen.queryByTestId("eval-dashboard-empty"), null);
});

test("EvalDashboardView_emptyFolder_showsNoCasesYetAndStaysListed", async () => {
  listAgentEvalSummariesHandler = () =>
    Promise.resolve([
      agentEvalSummary({ dirName: "agent-builder", cases: [] }),
      agentEvalSummary({
        dirName: "ana-soporte",
        cases: [evalCase()],
      }),
    ]);

  await act(async () => {
    renderView();
  });
  await settle();

  const cards = screen.getAllByTestId("agent-eval-card");
  assert.equal(cards.length, 2, "the empty folder is not hidden");

  const emptyCard = cards.find(
    (card) => card.getAttribute("data-agent-dir") === "agent-builder",
  );
  assert.ok(emptyCard, "agent-builder's card is still rendered");
  assert.match(
    emptyCard.textContent,
    /No cases yet/,
    "an empty folder reads as an explained empty state, not an error",
  );
  assert.match(emptyCard.textContent, /No bulletin yet/);
});

test("EvalDashboardView_missingRoot_showsExplainedEmptyStateNotBlank", async () => {
  // `list_agent_eval_summaries` on a missing/unreadable root comes back `[]`
  // — the same "not an error" contract `list_agent_evals` documents for a
  // missing directory, reused for the whole listing.
  listAgentEvalSummariesHandler = () => Promise.resolve([]);

  await act(async () => {
    renderView();
  });
  await settle();

  const empty = screen.getByTestId("eval-dashboard-empty");
  assert.match(empty.textContent, /No agent evals found yet/);
  assert.equal(screen.queryByTestId("agent-eval-card"), null);
  assert.equal(screen.queryByTestId("eval-dashboard-error"), null);
});

test("EvalDashboardView_readFailure_showsRetryableErrorNotCrash", async () => {
  listAgentEvalSummariesHandler = () =>
    Promise.reject(new Error("permission denied"));

  await act(async () => {
    renderView();
  });
  await settle();

  const error = screen.getByTestId("eval-dashboard-error");
  assert.match(error.textContent, /permission denied/);
});

test("EvalDashboardView_manualRefresh_pickUpsFolderCreatedByHand", async () => {
  // I4 (R4): pressing refresh re-reads the listing without remounting the
  // view. Simulates "create a folder by hand, press refresh → it appears" by
  // changing what the next invoke call returns and pressing the button —
  // the same query, refetched, not a new component instance.
  let calls = 0;
  listAgentEvalSummariesHandler = () => {
    calls += 1;
    return Promise.resolve(
      calls === 1
        ? [agentEvalSummary({ dirName: "agent-builder", cases: [] })]
        : [
            agentEvalSummary({ dirName: "agent-builder", cases: [] }),
            agentEvalSummary({ dirName: "qa-test-empty", cases: [] }),
          ],
    );
  };

  let view;
  await act(async () => {
    view = renderView();
  });
  await settle();

  assert.equal(screen.getAllByTestId("agent-eval-card").length, 1);

  fireEvent.click(screen.getByTestId("eval-dashboard-refresh"));
  await settle();

  assert.equal(calls, 2, "refresh triggers a second read of the listing");
  const cards = screen.getAllByTestId("agent-eval-card");
  assert.equal(cards.length, 2, "the newly created folder is picked up");
  assert.ok(
    cards.some(
      (card) => card.getAttribute("data-agent-dir") === "qa-test-empty",
    ),
  );
  // Same view instance throughout — refresh is a refetch, not a remount.
  assert.equal(
    screen.getByTestId("eval-dashboard-view"),
    view.getByTestId("eval-dashboard-view"),
  );
});

test("EvalDashboardView_manualRefresh_dropsFolderRemovedByHand", async () => {
  // I4 (R4): the inverse case — a folder deleted from disk disappears from
  // the listing after refresh, still without a full remount.
  let calls = 0;
  listAgentEvalSummariesHandler = () => {
    calls += 1;
    return Promise.resolve(
      calls === 1
        ? [
            agentEvalSummary({ dirName: "agent-builder", cases: [] }),
            agentEvalSummary({ dirName: "qa-test-empty", cases: [] }),
          ]
        : [agentEvalSummary({ dirName: "agent-builder", cases: [] })],
    );
  };

  await act(async () => {
    renderView();
  });
  await settle();

  assert.equal(screen.getAllByTestId("agent-eval-card").length, 2);

  fireEvent.click(screen.getByTestId("eval-dashboard-refresh"));
  await settle();

  assert.equal(calls, 2);
  const cards = screen.getAllByTestId("agent-eval-card");
  assert.equal(cards.length, 1, "the removed folder is gone after refresh");
  assert.equal(cards[0].getAttribute("data-agent-dir"), "agent-builder");
});

test("EvalDashboardView_manualRefresh_disablesButtonWhileFetching", async () => {
  // Guards against double-firing refetch while a read is already in flight
  // (`disabled={query.isFetching}` in the view).
  let resolveSecond;
  let calls = 0;
  listAgentEvalSummariesHandler = () => {
    calls += 1;
    if (calls === 1) {
      return Promise.resolve([
        agentEvalSummary({ dirName: "agent-builder", cases: [] }),
      ]);
    }
    return new Promise((resolve) => {
      resolveSecond = resolve;
    });
  };

  await act(async () => {
    renderView();
  });
  await settle();

  const button = screen.getByTestId("eval-dashboard-refresh");
  fireEvent.click(button);
  await settle();

  assert.equal(
    button.disabled,
    true,
    "disabled while the refetch is in flight",
  );

  await act(async () => {
    resolveSecond([agentEvalSummary({ dirName: "agent-builder", cases: [] })]);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  assert.equal(button.disabled, false, "re-enabled once the refetch settles");
});

// ── I3: per-agent detail (R2, R6, R7) ───────────────────────────────────────

function feedbackEntry(overrides = {}) {
  return {
    date: "2026-08-29",
    author: "guillermo",
    status: "corregido",
    body: "Nota.",
    linkedCase: null,
    ...overrides,
  };
}

test("EvalDashboardView_selectCard_showsCasesWithFourFieldsAndBulletinTrendAndDate", async () => {
  // R2 (cases: title/origin/date/author) + R6 (trend+date of the current
  // bulletin, no time series) against a folder with a bulletin (`texter`
  // per the PRD's success criterion).
  listAgentEvalSummariesHandler = () =>
    Promise.resolve([
      agentEvalSummary({
        dirName: "texter",
        cases: [
          evalCase({
            author: "guillermo",
            date: "2026-08-20",
            fileName: "caso-01.md",
            number: 1,
            origin: "nacimiento",
            title: "Caso de nacimiento",
          }),
          evalCase({
            author: "ana",
            date: "2026-08-25",
            fileName: "caso-02.md",
            number: 2,
            origin: "feedback",
            title: "Caso de feedback",
          }),
        ],
        bulletin: {
          date: "2026-08-30",
          problems: [],
          rows: [],
          runner: "manual",
          score: "0.85",
          trend: "estable",
        },
      }),
    ]);

  await act(async () => {
    renderView();
  });
  await settle();

  assert.equal(screen.queryByTestId("agent-eval-detail"), null);

  fireEvent.click(screen.getByTestId("agent-eval-card"));
  await settle();

  const detail = screen.getByTestId("agent-eval-detail");
  assert.equal(detail.getAttribute("data-agent-dir"), "texter");

  // R6: trend and date of the current bulletin, nothing time-series.
  assert.equal(
    detail.querySelector('[data-testid="agent-evals-score"]').textContent,
    "0.85",
  );
  assert.match(
    detail.querySelector('[data-testid="agent-evals-trend"]').textContent,
    /estable/,
  );
  assert.match(detail.textContent, /2026-08-30/);

  // R2: each case shows title, origin, date, author.
  const cases = detail.querySelectorAll('[data-testid="agent-eval-case"]');
  assert.equal(cases.length, 2);
  assert.match(cases[0].textContent, /Caso de nacimiento/);
  assert.equal(
    cases[0].querySelector('[data-testid="agent-eval-origin"]').textContent,
    "at birth",
  );
  assert.match(cases[0].textContent, /2026-08-20/);
  assert.match(cases[0].textContent, /guillermo/);
  assert.match(cases[1].textContent, /Caso de feedback/);
  assert.equal(
    cases[1].querySelector('[data-testid="agent-eval-origin"]').textContent,
    "from feedback",
  );
  assert.match(cases[1].textContent, /2026-08-25/);
  assert.match(cases[1].textContent, /ana/);

  // Clicking the selected card again closes the detail.
  fireEvent.click(screen.getByTestId("agent-eval-card"));
  await settle();
  assert.equal(screen.queryByTestId("agent-eval-detail"), null);
});

test("EvalDashboardView_selectCard_withNoBulletin_showsNoBulletinYet", async () => {
  listAgentEvalSummariesHandler = () =>
    Promise.resolve([
      agentEvalSummary({
        dirName: "qa-engineer",
        cases: [evalCase()],
      }),
    ]);

  await act(async () => {
    renderView();
  });
  await settle();

  fireEvent.click(screen.getByTestId("agent-eval-card"));
  await settle();

  const detail = screen.getByTestId("agent-eval-detail");
  assert.match(detail.textContent, /No bulletin yet/);
});

test("EvalDashboardView_selectCard_feedbackLogOfSevenEntries_showsOnlyFiveMostRecent", async () => {
  // R2's edge case: with more than 5 entries, only the 5 most recent render.
  // The contract fixes newest-first order (§3.3), so "most recent" is the
  // first 5 of the fixture, not the last 5.
  const entries = [
    feedbackEntry({ body: "Entrada 1 (más reciente)." }),
    feedbackEntry({ body: "Entrada 2." }),
    feedbackEntry({ body: "Entrada 3." }),
    feedbackEntry({ body: "Entrada 4." }),
    feedbackEntry({ body: "Entrada 5." }),
    feedbackEntry({ body: "Entrada 6." }),
    feedbackEntry({ body: "Entrada 7 (más antigua)." }),
  ];
  listAgentEvalSummariesHandler = () =>
    Promise.resolve([
      agentEvalSummary({ dirName: "pm", cases: [], feedback: entries }),
    ]);

  await act(async () => {
    renderView();
  });
  await settle();

  fireEvent.click(screen.getByTestId("agent-eval-card"));
  await settle();

  const detail = screen.getByTestId("agent-eval-detail");
  const feedback = detail.querySelector('[data-testid="agent-evals-feedback"]');
  assert.match(feedback.textContent, /Feedback log \(5 of 7\)/);
  assert.match(feedback.textContent, /Entrada 1 \(más reciente\)/);
  assert.match(feedback.textContent, /Entrada 5/);
  assert.doesNotMatch(feedback.textContent, /Entrada 6/);
  assert.doesNotMatch(feedback.textContent, /Entrada 7/);
});

test("EvalDashboardView_selectCard_invalidCaseAndBulletin_showPathAndReasonWithoutBreakingRender", async () => {
  // R7: an invalid case/bulletin renders as invalid with its path and
  // reason, and does not stop the rest of the detail from rendering.
  listAgentEvalSummariesHandler = () =>
    Promise.resolve([
      agentEvalSummary({
        dir: "/nest/.agents/evals/agent-builder",
        dirName: "agent-builder",
        cases: [
          evalCase({ fileName: "caso-01.md", number: 1, title: "Caso sano" }),
          evalCase({
            fileName: "caso-02.md",
            number: 2,
            problems: [
              {
                code: "missing-expected",
                message: "Falta '## Output esperado'.",
              },
            ],
            title: "Caso roto",
          }),
        ],
        bulletin: {
          date: "2026-08-30",
          problems: [
            { code: "score-out-of-range", message: "puntuacion fuera de 0-1." },
          ],
          rows: [],
          runner: "manual",
          score: "1.40",
          trend: "sube",
        },
      }),
    ]);

  await act(async () => {
    renderView();
  });
  await settle();

  fireEvent.click(screen.getByTestId("agent-eval-card"));
  await settle();

  const detail = screen.getByTestId("agent-eval-detail");

  // Bulletin marked invalid, with its path and reason.
  assert.ok(
    detail.querySelector('[data-testid="agent-evals-bulletin-invalid"]'),
  );
  const bulletinProblems = detail.querySelector(
    '[data-testid="agent-evals-bulletin-problems"]',
  );
  assert.match(bulletinProblems.textContent, /boletin-ultimo\.md/);
  assert.match(bulletinProblems.textContent, /puntuacion fuera de 0-1/);

  // The healthy case still renders normally.
  const cases = detail.querySelectorAll('[data-testid="agent-eval-case"]');
  assert.equal(cases.length, 2, "the broken case does not remove the other");
  assert.match(cases[0].textContent, /Caso sano/);
  assert.equal(
    cases[0].querySelectorAll('[data-testid="agent-eval-case-invalid"]').length,
    0,
  );

  // The broken case is marked invalid; opening it shows path and reason.
  assert.ok(cases[1].querySelector('[data-testid="agent-eval-case-invalid"]'));
  fireEvent.click(cases[1].querySelector("button"));
  await settle();
  const casePath = cases[1].querySelector(
    '[data-testid="agent-eval-case-path"]',
  );
  assert.match(casePath.textContent, /agent-builder\/caso-02\.md/);
  assert.match(cases[1].textContent, /Falta '## Output esperado'/);
});
