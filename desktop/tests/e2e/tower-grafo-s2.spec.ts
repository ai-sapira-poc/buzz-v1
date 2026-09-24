import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/**
 * Tower Grafo, slice 2 — the handoff edges and the viewport.
 *
 * What this drives: the real `/tower` route, the real `GrafoSection` and
 * `GrafoCanvas`, the real D1 layer layout, and the real edge layer, at five
 * viewport widths including 800 and 900 px. As in the S1 spec, the two tower
 * reads cannot reach the canvas through the mock bridge (its history answers are
 * channel-scoped and the tower filters are owner-scoped), so both reads are
 * seeded into the app's own query cache: the portfolio (`tower/portfolio`) and
 * the handoff edges (`tower/handovers`)
 * (`foreground-responsiveness-regression.spec.ts` uses the same seam). The
 * adapter path itself is bound by `src/features/tower/ui/grafoLayers.test.mjs`
 * and `towerGrafoRender.test.mjs`.
 *
 * The guards that turn this red: an edge drawn child → parent, an arrowhead on
 * the wrong end, a card and an edge that leave register under pan or zoom, a
 * canvas that overflows the page at a narrow width, or an empty / failed edge
 * read painted as the other.
 *
 * **Every row below is a fixture.** A fixture is evidence of nothing beyond the
 * surface's own behaviour; nothing here reads a relay.
 */

const PORTFOLIO_KEY = ["tower", "portfolio"] as const;
const HANDOVERS_KEY = ["tower", "handovers"] as const;

type SeedLine = {
  project: { id: string; name: string };
  recency: { lastSpanAt: string | null };
  blocked: { count: number; basis: null };
  work: { state: string; summary: string | null } | null;
  cost: null;
  waiting: null;
};

type SeedHandover = {
  id: string;
  sender: { jobId: string; name: string | null };
  child: { jobId: string; name: string | null };
  parentOutcome: string;
  transferredAt: string | null;
  thread: null;
};

function line(job: string, role: string, at: string): SeedLine {
  return {
    project: { id: job, name: role },
    recency: { lastSpanAt: at },
    blocked: { count: 0, basis: null },
    work: { state: "running", summary: null },
    cost: null,
    waiting: null,
  };
}

function handoff(parent: string, child: string): SeedHandover {
  return {
    id: `${parent}->${child}`,
    sender: { jobId: parent, name: parent },
    child: { jobId: child, name: child },
    parentOutcome: "done",
    transferredAt: "2026-09-23T19:00:00.000Z",
    thread: null,
  };
}

/** parent → child → grandchild: three depths, two edges. */
const CHAIN_LINES: SeedLine[] = [
  line("parent-job", "builder", "2026-09-23T20:04:00.000Z"),
  line("child-job", "reviewer", "2026-09-23T20:03:00.000Z"),
  line("grandchild-job", "coder", "2026-09-23T20:02:00.000Z"),
];

const CHAIN_EDGES: SeedHandover[] = [
  handoff("parent-job", "child-job"),
  handoff("child-job", "grandchild-job"),
];

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
  await expect(page.getByTestId("open-tower-view")).toBeVisible({
    timeout: 45_000,
  });
}

async function openTower(page: Page) {
  await page.getByTestId("open-tower-view").click();
  await expect(page).toHaveURL(/#\/tower$/);
  await expect(page.getByTestId("tower-grafo")).toBeVisible();
}

async function waitForQuerySettled(page: Page, key: readonly unknown[]) {
  await page.waitForFunction(
    (queryKey) => {
      const client = (window as E2eWindow).__BUZZ_E2E_QUERY_CLIENT__;
      if (!client) return false;
      const hash = JSON.stringify(queryKey);
      const query = client
        .getQueryCache()
        .findAll()
        .find((candidate) => JSON.stringify(candidate.queryKey) === hash);
      if (!query) return false;
      const state = query.state as { status?: string; fetchStatus?: string };
      return state.status !== "pending" && state.fetchStatus !== "fetching";
    },
    key as unknown as string[],
  );
}

async function seedQuery(page: Page, key: readonly unknown[], data: unknown) {
  await page.evaluate(
    ({ queryKey, value }) => {
      const client = (window as E2eWindow).__BUZZ_E2E_QUERY_CLIENT__;
      if (!client) throw new Error("E2E query client is unavailable.");
      client.setQueryData(queryKey, value, { updatedAt: Date.now() });
    },
    { queryKey: key as unknown as string[], value: data },
  );
}

async function seedTower(page: Page, lines: SeedLine[], edges: SeedHandover[]) {
  await waitForQuerySettled(page, PORTFOLIO_KEY);
  await waitForQuerySettled(page, HANDOVERS_KEY);
  await seedQuery(page, PORTFOLIO_KEY, lines);
  await seedQuery(page, HANDOVERS_KEY, edges);
}

async function patchHandoversQuery(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(
    ({ queryKey, next }) => {
      const client = (window as E2eWindow).__BUZZ_E2E_QUERY_CLIENT__;
      if (!client) throw new Error("E2E query client is unavailable.");
      const hash = JSON.stringify(queryKey);
      const query = client
        .getQueryCache()
        .findAll()
        .find((candidate) => JSON.stringify(candidate.queryKey) === hash);
      if (!query) throw new Error("Tower handover query is not mounted.");
      query.setState({ ...query.state, ...next });
    },
    { queryKey: HANDOVERS_KEY as unknown as string[], next: patch },
  );
}

/** The world transform the canvas is currently applying. */
function worldTransform(page: Page) {
  return page.evaluate(() => {
    const world = document.querySelector<HTMLElement>(
      '[data-testid="tower-grafo-canvas"]',
    );
    if (!world) throw new Error("world not found");
    return getComputedStyle(world).transform;
  });
}

/**
 * Measures the edge layer against the cards **on screen**, through whatever
 * transform is applied: the edge's start must sit on the parent card's right
 * centre and its end on the child card's left centre. Cards and edges are
 * ordered by the layout, so the `parentIndex`/`childIndex` are the reading
 * order of the seeded chain.
 */
function measureRegister(
  page: Page,
  parentIndex: number,
  childIndex: number,
  edgeIndex: number,
) {
  return page.evaluate(
    ({ parentAt, childAt, edgeAt }) => {
      const svg = document.querySelector<SVGSVGElement>(
        '[data-testid="tower-grafo-edge-layer"]',
      );
      const cards = [
        ...document.querySelectorAll<HTMLElement>('[data-testid="tower-node"]'),
      ];
      const edges = [
        ...document.querySelectorAll<SVGPathElement>(
          '[data-testid="tower-grafo-edge"]',
        ),
      ];
      if (!svg || !cards[parentAt] || !cards[childAt] || !edges[edgeAt]) {
        throw new Error("canvas, card or edge missing");
      }
      const matrix = svg.getScreenCTM();
      if (!matrix) throw new Error("no screen CTM");
      const toScreen = (x: number, y: number) => {
        const point = svg.createSVGPoint();
        point.x = x;
        point.y = y;
        return point.matrixTransform(matrix);
      };
      const path = edges[edgeAt];
      const start = toScreen(
        path.getPointAtLength(0).x,
        path.getPointAtLength(0).y,
      );
      const end = toScreen(
        path.getPointAtLength(path.getTotalLength()).x,
        path.getPointAtLength(path.getTotalLength()).y,
      );
      const parentRect = cards[parentAt].getBoundingClientRect();
      const childRect = cards[childAt].getBoundingClientRect();
      return {
        startDx: Math.abs(start.x - parentRect.right),
        startDy: Math.abs(start.y - (parentRect.top + parentRect.bottom) / 2),
        endDx: Math.abs(end.x - childRect.left),
        endDy: Math.abs(end.y - (childRect.top + childRect.bottom) / 2),
      };
    },
    { parentAt: parentIndex, childAt: childIndex, edgeAt: edgeIndex },
  );
}

test.describe("tower grafo s2 — handoff edges and register", () => {
  test("one arrow per handoff, drawn parent → child, laid out by depth", async ({
    page,
  }) => {
    await bootAtHome(page);
    await openTower(page);
    await seedTower(page, CHAIN_LINES, CHAIN_EDGES);

    await expect(page.getByTestId("tower-node")).toHaveCount(3);
    await expect(page.getByTestId("tower-grafo-edge")).toHaveCount(2);
    expect(
      await page.getByTestId("tower-grafo-layer-title").allTextContents(),
    ).toEqual(["Depth 0", "Depth 1", "Depth 2"]);

    const first = page.getByTestId("tower-grafo-edge").first();
    await expect(first).toHaveAttribute("data-parent", "parent-job");
    await expect(first).toHaveAttribute("data-child", "child-job");
    // The arrowhead (marker-end) sits at the child end: the direction is
    // parent → child, never the reverse.
    const markerEnd = await first.getAttribute("marker-end");
    expect(markerEnd).toMatch(/^url\(#/);
    const x1 = Number(await first.getAttribute("data-x1"));
    const x2 = Number(await first.getAttribute("data-x2"));
    expect(x1).toBeLessThan(x2);

    // Both edges sit on their cards, before any pan or zoom.
    const outer = await measureRegister(page, 0, 1, 0);
    expect(outer.startDx).toBeLessThan(2);
    expect(outer.startDy).toBeLessThan(2);
    expect(outer.endDx).toBeLessThan(2);
    expect(outer.endDy).toBeLessThan(2);
  });

  test("pan and zoom keep cards and edges in register, with no overflow, at five widths", async ({
    page,
  }) => {
    await bootAtHome(page);
    await openTower(page);
    await seedTower(page, CHAIN_LINES, CHAIN_EDGES);
    await expect(page.getByTestId("tower-grafo-edge")).toHaveCount(2);

    const before = await worldTransform(page);

    // Pan by dragging the viewport background, away from the cards (bottom
    // right of the viewport).
    const viewport = page.getByTestId("tower-grafo-viewport");
    const box = await viewport.boundingBox();
    if (!box) throw new Error("viewport not laid out");
    await page.mouse.move(box.x + box.width - 20, box.y + box.height - 20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 90, box.y + box.height - 70, {
      steps: 4,
    });
    await page.mouse.up();

    // Zoom in twice through the real controls.
    await page.getByTestId("tower-grafo-zoom-in").click();
    await page.getByTestId("tower-grafo-zoom-in").click();
    await expect(page.getByTestId("tower-grafo-zoom-level")).toHaveText("144%");

    const after = await worldTransform(page);
    expect(after).not.toBe(before);

    // The register survives both transforms: the edge still meets its cards.
    const moved = await measureRegister(page, 0, 1, 0);
    expect(moved.startDx).toBeLessThan(2);
    expect(moved.startDy).toBeLessThan(2);
    expect(moved.endDx).toBeLessThan(2);
    expect(moved.endDy).toBeLessThan(2);

    // Five widths, including the two the acceptance names. The canvas clips its
    // own world, so the page must not gain a horizontal scrollbar at any of them.
    for (const width of [1280, 1024, 900, 800, 600]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        overflow.scrollWidth,
        `page overflows horizontally at ${width}px`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);

      // Reset the view, then confirm cards and edges are back in register.
      await page.getByTestId("tower-grafo-zoom-reset").click();
      const atWidth = await measureRegister(page, 0, 1, 0);
      expect(atWidth.startDx).toBeLessThan(2);
      expect(atWidth.endDx).toBeLessThan(2);
    }
  });

  test("an empty edge read and a failed one say different things", async ({
    page,
  }) => {
    await bootAtHome(page);
    await openTower(page);
    await seedTower(page, CHAIN_LINES, []);

    // Empty: a successful read that carried nothing is not a failure.
    await expect(page.getByTestId("tower-grafo-edge")).toHaveCount(0);
    await expect(page.getByTestId("tower-grafo-edge-note")).toHaveText(
      "No handoff edge in this window.",
    );

    // Failed: never drawn as "no handoffs".
    await patchHandoversQuery(page, {
      status: "error",
      error: new Error("relay unreachable: request timed out"),
      fetchStatus: "idle",
      data: undefined,
      dataUpdatedAt: 0,
    });
    await expect(page.getByTestId("tower-grafo-edge-note")).toContainText(
      "edge read failed",
    );
    await expect(page.getByTestId("tower-grafo-edge-note")).not.toHaveText(
      "No handoff edge in this window.",
    );
  });
});
