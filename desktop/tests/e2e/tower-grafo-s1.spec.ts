import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/**
 * Tower Grafo, slice 1 — the canvas the operator reads.
 *
 * What this drives: the real `/tower` route behind the preview-feature gate,
 * the real `GrafoSection` and its phase branches, and the real keyboard path.
 * The tower read itself cannot reach the canvas through the mock bridge (the
 * mock answers only channel-scoped history, and the tower filter is scoped to
 * the owner), so the lines are seeded into the app's own query cache — the
 * idiom `foreground-responsiveness-regression.spec.ts` already uses — and the
 * adapter path is bound by `src/features/tower/ui/towerGrafoRender.test.mjs`,
 * which runs the real adapter end to end.
 *
 * The guards that turn this red: an absent cost or model painted as a measured
 * zero, a total summed over a partial read, a connector drawn on a surface with
 * no edge producer, a grouping that does not say what it is, a blank surface
 * state, a `requested` card presented as a measured state, a canvas that leaves
 * the tab order, a canvas that takes focus on a plain data transition, or one
 * that never takes it after the operator's own Retry.
 *
 * **Every line below is a fixture.** Nothing else can feed this canvas through
 * the mock bridge, and a fixture is evidence of nothing: in particular the
 * `requested` line is seeded because the fold admits that state, not because
 * anyone emits 43001 today — no caller passes `"created"` (taxonomy §2). The
 * card is required not to draw it as a state, and this spec asserts it does not.
 *
 * Each case boots the app once, so cases are merged where they share a boot:
 * the app shell's own gate (`community.isReady`) is the slowest and least
 * reliable step in this repo's mock harness, and it is shared with every other
 * spec.
 */

const PORTFOLIO_KEY = ["tower", "portfolio"] as const;

type SeedLine = {
  project: { id: string; name: string };
  recency: { lastSpanAt: string | null };
  blocked: { count: number; basis: null };
  work: { state: string; summary: string | null } | null;
  cost: null | {
    inputTokens: number;
    outputTokens: number;
    coverage: { observedAgents: number; totalAgents: number };
  };
  waiting: null | { reason: string; at: string };
};

/**
 * One line exactly as `towerBuzzSource` builds it: the `job` tag is the id, the
 * `role` tag is the name, and everything the read cannot source is `null`.
 */
function line(
  job: string,
  role: string,
  {
    at = "2026-09-23T20:00:00.000Z",
    state = "running",
    summary = null,
    cost = null,
  }: {
    at?: string;
    state?: string | null;
    summary?: string | null;
    cost?: SeedLine["cost"];
  } = {},
): SeedLine {
  return {
    project: { id: job, name: role },
    recency: { lastSpanAt: at },
    // No lifecycle evidence rides these seeds, so the basis stays `null`:
    // the canvas has no blocked signal to claim.
    blocked: { count: 0, basis: null },
    work: state === null ? null : { state, summary },
    cost,
    waiting: null,
  };
}

type E2eWindow = typeof window & {
  __BUZZ_E2E_QUERY_CLIENT__?: {
    setQueryData: (
      key: readonly unknown[],
      data: unknown,
      options?: { updatedAt?: number },
    ) => void;
    getQueryCache: () => {
      findAll: () => Array<{
        queryKey: readonly unknown[];
        state: Record<string, unknown>;
        setState: (state: Record<string, unknown>) => void;
      }>;
    };
  };
};

async function bootAtHome(page: Page) {
  await installMockBridge(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // The sidebar entry appears only once the app shell has mounted (identity,
  // community, feature flags) — the same gate every spec in this repo waits on.
  // Boot is occasionally slow on a loaded host, so this one wait is generous;
  // everything after it is quick.
  await expect(page.getByTestId("open-tower-view")).toBeVisible({
    timeout: 45_000,
  });
}

async function openTower(page: Page) {
  await page.getByTestId("open-tower-view").click();
  await expect(page).toHaveURL(/#\/tower$/);
  await expect(page.getByTestId("tower-grafo")).toBeVisible();
}

/**
 * Waits until the tower read has settled.
 *
 * The mock's answer arrives asynchronously, so a seed written while the read is
 * still in flight is overwritten by the read's own result. Every case waits for
 * the query to leave `pending`/`fetching` before it replaces the answer.
 */
async function waitForPortfolioSettled(page: Page) {
  await page.waitForFunction(
    (key) => {
      const client = (window as E2eWindow).__BUZZ_E2E_QUERY_CLIENT__;
      if (!client) return false;
      const hash = JSON.stringify(key);
      const query = client
        .getQueryCache()
        .findAll()
        .find((candidate) => JSON.stringify(candidate.queryKey) === hash);
      if (!query) return false;
      const state = query.state as { status?: string; fetchStatus?: string };
      return state.status !== "pending" && state.fetchStatus !== "fetching";
    },
    PORTFOLIO_KEY as unknown as string[],
  );
}

async function seedPortfolio(page: Page, lines: SeedLine[]) {
  await page.evaluate(
    ({ key, lines }) => {
      const client = (window as E2eWindow).__BUZZ_E2E_QUERY_CLIENT__;
      if (!client) throw new Error("E2E query client is unavailable.");
      client.setQueryData(key, lines, { updatedAt: Date.now() });
    },
    { key: PORTFOLIO_KEY as unknown as string[], lines },
  );
}

type QueryPatch = Record<string, unknown>;

/**
 * Rewrites the portfolio query's own state.
 *
 * The mock relay answers the tower read instantly, so neither the in-flight nor
 * the terminal-failure branch can be reached by waiting: the state a pending or
 * failed read produces is set on the query the app already mounted. The same
 * seam `foreground-responsiveness-regression.spec.ts` uses.
 */
async function patchPortfolioQuery(page: Page, patch: QueryPatch) {
  await page.evaluate(
    ({ key, patch }) => {
      const client = (window as E2eWindow).__BUZZ_E2E_QUERY_CLIENT__;
      if (!client) throw new Error("E2E query client is unavailable.");
      const hash = JSON.stringify(key);
      const query = client
        .getQueryCache()
        .findAll()
        .find((candidate) => JSON.stringify(candidate.queryKey) === hash);
      if (!query) throw new Error("Tower portfolio query is not mounted.");
      query.setState({ ...query.state, ...patch });
    },
    { key: PORTFOLIO_KEY as unknown as string[], patch },
  );
}

const FOUR_LINES: SeedLine[] = [
  line("tower-grafo", "builder", {
    at: "2026-09-23T20:04:00.000Z",
    summary: "drawing the cards",
  }),
  line("buzz-autonomy", "builder", { at: "2026-09-23T20:03:00.000Z" }),
  // Fixture, and the only place `requested` can come from today: 43001 has no
  // caller emitting it (taxonomy §2). Its card must not read as a measurement.
  line("npl-mp", "reviewer", {
    at: "2026-09-23T20:02:00.000Z",
    state: "requested",
    summary: "auditing the frontier document",
  }),
  line("orphan-wait", "Unnamed agent", {
    at: "2026-09-23T20:01:00.000Z",
    state: null,
  }),
];

test.describe("tower grafo s1 — cards in the depth layout", () => {
  test("one card per job in a layer per depth, and no edge without an edge read", async ({
    page,
  }) => {
    await bootAtHome(page);
    await openTower(page);
    await waitForPortfolioSettled(page);
    await seedPortfolio(page, FOUR_LINES);

    await expect(page.getByTestId("tower-node")).toHaveCount(4);
    // No handoff edge is seeded, so every node is a window root: one layer, and
    // it is labelled as this window's depth, never as an absolute hierarchy.
    await expect(page.getByTestId("tower-grafo-layer")).toHaveCount(1);
    expect(
      await page.getByTestId("tower-grafo-layer-title").allTextContents(),
    ).toEqual(["Depth 0"]);

    const canvas = page.getByTestId("tower-grafo-canvas");
    // The edge read is not seeded here, so nothing connects two cards. The
    // canvas says that fact in words instead of painting a silent blank.
    await expect(canvas.getByTestId("tower-grafo-edge")).toHaveCount(0);
    await expect(page.getByTestId("tower-grafo-edge-note")).toBeVisible();

    // The job id is the subject; the column names the role, so the card does not
    // repeat it.
    await expect(page.getByTestId("tower-node").first()).toContainText(
      "tower-grafo",
    );
    await expect(page.getByTestId("tower-node")).toContainText([
      "Running",
      "Running",
      "No signal",
      "No run reported",
    ]);

    // `requested` (43001) is the one legible state with no caller emitting it
    // today, so S1 does not draw it: its chip names the absence instead of the
    // state, in words, with no figure. Scoped to the card so the assertion does
    // not depend on card order.
    const requestedCard = page
      .getByTestId("tower-node")
      .filter({ hasText: "npl-mp" });
    await expect(requestedCard.getByTestId("tower-node-state")).toHaveText(
      "No signal",
    );
    // The state's own label is exactly what must not render, and the card does
    // not borrow a produced state's colour either.
    await expect(requestedCard).not.toContainText("Requested");
    await expect(requestedCard).not.toHaveClass(/border-l-sky-500/);

    // The grouping is named for what it is, and says where depth will come from
    // — a column is a role, not a level.
    const note = page.getByTestId("tower-grafo-grouping-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText("depth in this window");
    await expect(note).toContainText("not an absolute hierarchy");
  });

  test("an absent model and cost are never a measured zero, and never a total", async ({
    page,
  }) => {
    await bootAtHome(page);
    await openTower(page);
    await waitForPortfolioSettled(page);
    await seedPortfolio(page, FOUR_LINES);

    const model = page.getByTestId("tower-node-model");
    const cost = page.getByTestId("tower-node-cost");
    await expect(model).toHaveCount(4);
    await expect(model).toHaveText([
      "Not available",
      "Not available",
      "Not available",
      "Not available",
    ]);
    await expect(cost).toHaveText([
      "Not available",
      "Not available",
      "Not available",
      "Not available",
    ]);

    const canvas = page.getByTestId("tower-grafo-canvas");
    await expect(canvas).not.toContainText("$");
    await expect(canvas).not.toContainText("0 tok");
    await expect(canvas).not.toContainText(/total/i);
    // The read cannot say a line is blocked, so the surface says nothing at all.
    await expect(canvas).not.toContainText(/blocked/i);

    // The same read, once the source does carry a spend: the sum travels with
    // the coverage it was computed over instead of standing alone.
    await seedPortfolio(page, [
      line("tower-grafo", "builder", {
        cost: {
          inputTokens: 1200,
          outputTokens: 300,
          coverage: { observedAgents: 1, totalAgents: 2 },
        },
      }),
    ]);
    await expect(page.getByTestId("tower-node-cost")).toHaveText(
      "1,500 tok · observed 1 of 2 agents",
    );
    await expect(canvas).not.toContainText("$");
    await expect(canvas).not.toContainText(/total/i);
  });

  test("every card is reachable from the keyboard", async ({ page }) => {
    await bootAtHome(page);
    await openTower(page);
    await waitForPortfolioSettled(page);
    await seedPortfolio(page, FOUR_LINES);

    const cards = page.getByTestId("tower-node");
    await expect(cards).toHaveCount(4);

    // The canvas is one tab stop: exactly one card carries the roving stop.
    const tabindexes = await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("tabindex")),
    );
    expect(tabindexes.filter((value) => value === "0")).toHaveLength(1);

    // And the stop is genuinely in the tab order, not only in the attribute.
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    let reached = false;
    for (let step = 0; step < 80 && !reached; step += 1) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(
        () =>
          document.activeElement?.getAttribute("data-testid") === "tower-node",
      );
    }
    expect(reached).toBe(true);

    await cards.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(cards.nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(cards.nth(3)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(cards.nth(0)).toBeFocused();
  });
});

test.describe("tower grafo s1 — every surface state says something", () => {
  test("in flight, empty and failed each render text, never a blank canvas", async ({
    page,
  }) => {
    await bootAtHome(page);
    await openTower(page);
    await waitForPortfolioSettled(page);

    // One read, one announcement. The canvas owns no live region: it and the
    // panel branch on the same `PortfolioView` phase, so a region in each
    // announced one transition twice. This locator is the regression guard —
    // a region added inside the graph subtree, or on the graph section itself,
    // turns every assertion below red.
    const announcementInGraph = page.locator(
      '[data-testid="tower-grafo"] [aria-live], [data-testid="tower-grafo"][aria-live]',
    );
    await expect(announcementInGraph).toHaveCount(0);

    // In flight.
    await patchPortfolioQuery(page, {
      status: "pending",
      fetchStatus: "fetching",
      data: undefined,
      dataUpdatedAt: 0,
    });
    await expect(page.getByTestId("tower-loading-state")).toBeVisible();
    await expect(page.getByTestId("panel-status-announcement")).toHaveText(
      "Leyendo los encargos — aún buscando, no es un vacío",
    );
    await expect(page.getByTestId("tower-node")).toHaveCount(0);
    await expect(announcementInGraph).toHaveCount(0);

    // Empty: a successful read that carried nothing is not a failure, and it
    // must not be a blank surface either.
    await seedPortfolio(page, []);
    await expect(page.getByTestId("tower-empty-state")).toBeVisible();
    await expect(page.getByTestId("tower-empty-state")).toContainText(
      "No lines to show yet",
    );
    await expect(page.getByTestId("panel-status-announcement")).toHaveText(
      "No hay encargos en este periodo",
    );
    await expect(announcementInGraph).toHaveCount(0);

    // Failed: the motive and a way back, never a figure.
    await patchPortfolioQuery(page, {
      status: "error",
      error: new Error("relay unreachable: request timed out"),
      fetchStatus: "idle",
      data: undefined,
      dataUpdatedAt: 0,
    });
    const error = page.getByTestId("tower-error-state");
    await expect(error).toBeVisible();
    await expect(error).toContainText("Could not read the telemetry source");
    await expect(
      page.getByTestId("tower-grafo").getByRole("button", { name: "Retry" }),
    ).toBeVisible();
    await expect(page.getByTestId("tower-node")).toHaveCount(0);
    await expect(page.getByTestId("panel-status-announcement")).toHaveText(
      "No se pudo leer el registro de encargos",
    );
    await expect(announcementInGraph).toHaveCount(0);
  });

  test("the operator's own Retry hands focus to the canvas, and nothing else does", async ({
    page,
  }) => {
    await bootAtHome(page);
    await openTower(page);
    await waitForPortfolioSettled(page);

    // A plain loading → data transition must not steal focus: the operator may
    // be anywhere else on the page when the read lands.
    await patchPortfolioQuery(page, {
      status: "pending",
      fetchStatus: "fetching",
      data: undefined,
      dataUpdatedAt: 0,
    });
    await expect(page.getByTestId("tower-loading-state")).toBeVisible();
    const elsewhere = page.getByTestId("open-tower-view");
    await elsewhere.focus();
    await seedPortfolio(page, FOUR_LINES);
    await expect(page.getByTestId("tower-node")).toHaveCount(4);
    await expect(page.getByTestId("tower-node").first()).not.toBeFocused();
    await expect(elsewhere).toBeFocused();

    // The one legitimate hand-off: the operator's own Retry in this section,
    // once it resolves into the canvas. The row list the canvas replaced
    // carried the same affordance (spec §6), so it must not vanish with the
    // list. The section's own Retry is scoped for: the panel's retry button
    // calls the same refetch but is not this surface's hand-off.
    await patchPortfolioQuery(page, {
      status: "error",
      error: new Error("relay unreachable: request timed out"),
      fetchStatus: "idle",
      data: undefined,
      dataUpdatedAt: 0,
    });
    await expect(page.getByTestId("tower-error-state")).toBeVisible();
    await page
      .getByTestId("tower-grafo")
      .getByRole("button", { name: "Retry" })
      .click();
    await waitForPortfolioSettled(page);
    await seedPortfolio(page, FOUR_LINES);
    await expect(page.getByTestId("tower-node")).toHaveCount(4);
    await expect(page.getByTestId("tower-node").first()).toBeFocused();
  });
});
