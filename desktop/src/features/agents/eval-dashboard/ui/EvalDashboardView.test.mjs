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
let createElement;
let QueryClient;
let QueryClientProvider;
let EvalDashboardView;

before(async () => {
  Object.assign(globalThis, {
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
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

  ({ act, cleanup, render, screen } = await import("@testing-library/react"));
  ({ createElement } = await import("react"));
  ({ QueryClient, QueryClientProvider } = await import(
    "@tanstack/react-query"
  ));
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
      QueryClientProvider,
      { client },
      createElement(EvalDashboardView),
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
