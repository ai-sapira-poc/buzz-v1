import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/**
 * Tower Grafo, slice 2 — the handoff edges and the viewport.
 *
 * What this drives: the real `/tower` route, the real `GrafoSection` and
 * `GrafoCanvas`, the real D1 layer layout, and the real edge layer, at the five
 * acceptance widths. As in the S1 spec, the two tower reads cannot reach the
 * canvas through the mock bridge (its history answers are channel-scoped and the
 * tower filters are owner-scoped), so both reads are seeded into the app's own
 * query cache: the portfolio (`tower/portfolio`) and the handoff edges
 * (`tower/handovers`) (`foreground-responsiveness-regression.spec.ts` uses the
 * same seam). The adapter path itself is bound by
 * `src/features/tower/ui/grafoLayers.test.mjs` and `towerGrafoRender.test.mjs`.
 *
 * Three named overflow boxes, so "no overflow" is falsifiable rather than an
 * opinion: **B1** the page (no horizontal scrollbar), **B2** the surface's rect
 * inside the Tower column's *content* border, **B3** the surface's own layout
 * width inside that same content box. A card rect is deliberately **not** a box:
 * the canvas clips its world, so a panned card's rect legitimately extends past
 * the column while nothing visible leaves it — that ambiguity is exactly what
 * the r2 verdict on S1 measured around.
 *
 * The guards that turn this red: an edge drawn child → parent, an arrowhead on
 * the wrong end, a card and an edge that leave register under pan or zoom, a
 * canvas that overflows a named box at a narrow width, an empty / failed /
 * loading edge read painted as another, an orphan given a depth nobody
 * published, or a zoom below the readable floor.
 *
 * **Every row below is a fixture.** A fixture is evidence of nothing beyond the
 * surface's own behaviour; nothing here reads a relay.
 */

const PORTFOLIO_KEY = ["tower", "portfolio"] as const;
const HANDOVERS_KEY = ["tower", "handovers"] as const;

/** The five acceptance widths. 800 is the desktop window's own `minWidth`. */
const ACCEPTANCE_WIDTHS = [1280, 1100, 1024, 900, 800];

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

function handoff(
  parent: string,
  child: string,
  names: { parent?: string | null; child?: string | null } = {},
): SeedHandover {
  return {
    id: `${parent}->${child}`,
    sender: {
      jobId: parent,
      name: names.parent === undefined ? parent : names.parent,
    },
    child: {
      jobId: child,
      name: names.child === undefined ? child : names.child,
    },
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
 * Register, measured **on screen** through whatever transform is applied: the
 * edge's start must sit on the parent card's right centre and its end on the
 * child card's left centre. The contract's tolerance is ±1 px.
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

/** B1 / B2 / B3, plus what the state-loss check needs. */
function measureBoxes(page: Page) {
  return page.evaluate(() => {
    const column = document.querySelector<HTMLElement>(
      '[data-testid="tower-column"]',
    );
    const surface = document.querySelector<HTMLElement>(
      '[data-testid="tower-grafo"]',
    );
    if (!column || !surface) throw new Error("column or surface missing");
    const style = getComputedStyle(column);
    const columnBox = column.getBoundingClientRect();
    const contentLeft = columnBox.left + parseFloat(style.paddingLeft);
    const contentRight = columnBox.right - parseFloat(style.paddingRight);
    const surfaceBox = surface.getBoundingClientRect();
    const doc = document.documentElement;
    return {
      b1: { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth },
      b2: {
        surfaceLeft: surfaceBox.left,
        surfaceRight: surfaceBox.right,
        contentLeft,
        contentRight,
      },
      b3: {
        surfaceOffsetWidth: surface.offsetWidth,
        contentWidth: contentRight - contentLeft,
      },
    };
  });
}

/** How much of a card is inside the canvas frame: 0 means unreachable. */
function visibleCardArea(page: Page, index: number) {
  return page.evaluate((at) => {
    const frame = document.querySelector<HTMLElement>(
      '[data-testid="tower-grafo-viewport"]',
    );
    const cards = [
      ...document.querySelectorAll<HTMLElement>('[data-testid="tower-node"]'),
    ];
    if (!frame || !cards[at]) throw new Error("frame or card missing");
    const a = cards[at].getBoundingClientRect();
    const b = frame.getBoundingClientRect();
    const width = Math.max(
      0,
      Math.min(a.right, b.right) - Math.max(a.left, b.left),
    );
    const height = Math.max(
      0,
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
    );
    return width * height;
  }, index);
}

function stateChipFont(page: Page, index: number) {
  return page.evaluate((at) => {
    const chips = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid="tower-node-state"]',
      ),
    ];
    if (!chips[at]) throw new Error("state chip missing");
    return {
      fontSize: getComputedStyle(chips[at]).fontSize,
      height: chips[at].getBoundingClientRect().height,
      width: chips[at].getBoundingClientRect().width,
    };
  }, index);
}

async function dragCanvas(page: Page, dx: number, dy: number) {
  const box = await page.getByTestId("tower-grafo-viewport").boundingBox();
  if (!box) throw new Error("viewport not laid out");
  // Start on the frame's bottom-left background, away from cards and controls.
  const startX = box.x + 12;
  const startY = box.y + box.height - 12;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 4 });
  await page.mouse.up();
}

test.describe("tower grafo s2 — edges, orphans and the viewport", () => {
  test("one arrow per handoff, parent → child, with the role on the card", async ({
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
    // parent → child, never the reverse, and it is a shape, not a colour.
    await expect(first).toHaveAttribute("marker-end", /^url\(#/);
    const x1 = Number(await first.getAttribute("data-x1"));
    const x2 = Number(await first.getAttribute("data-x2"));
    expect(x1).toBeLessThan(x2);

    // The role no longer has a column heading to live in: it rides the card.
    const roles = await page.getByTestId("tower-node-role").allTextContents();
    expect(roles).toEqual(["builder", "reviewer", "coder"]);

    // Both edges sit on their cards, before any pan or zoom (±1 px).
    for (const [parentAt, childAt, edgeAt] of [
      [0, 1, 0],
      [1, 2, 1],
    ]) {
      const register = await measureRegister(page, parentAt, childAt, edgeAt);
      expect(register.startDx, `edge ${edgeAt} start`).toBeLessThanOrEqual(1);
      expect(register.startDy, `edge ${edgeAt} start`).toBeLessThanOrEqual(1);
      expect(register.endDx, `edge ${edgeAt} end`).toBeLessThanOrEqual(1);
      expect(register.endDy, `edge ${edgeAt} end`).toBeLessThanOrEqual(1);
    }
  });

  test("an edge endpoint outside the window is drawn in the no-depth band", async ({
    page,
  }) => {
    await bootAtHome(page);
    await openTower(page);
    // The window holds only the child; the edge names a parent it never read.
    await seedTower(
      page,
      [line("child-job", "reviewer", "2026-09-23T20:03:00.000Z")],
      [handoff("absent-parent", "child-job", { parent: "arquitecto" })],
    );

    await expect(page.getByTestId("tower-node")).toHaveCount(2);
    await expect(page.getByTestId("tower-grafo-edge")).toHaveCount(1);

    // The child keeps the depth its own window's edges give it; the orphan gets
    // none — a layer would assert a depth nobody published.
    expect(
      await page.getByTestId("tower-grafo-layer-title").allTextContents(),
    ).toEqual(["Depth 0", "No depth"]);

    const orphan = page.locator(
      '[data-testid="tower-node"][data-orphan="true"]',
    );
    await expect(orphan).toHaveCount(1);
    await expect(orphan).toContainText("absent-parent");
    // The vocabulary of absence the surface already had, and no figure.
    await expect(orphan.getByTestId("tower-node-role")).toHaveText(
      "arquitecto",
    );
    await expect(orphan.getByTestId("tower-node-state")).toHaveText(
      "No run reported",
    );
    await expect(orphan).toContainText("Not available");
    await expect(orphan).not.toContainText("$");
  });

  test("pan and zoom keep register, are bounded, and lose no card state", async ({
    page,
  }) => {
    await bootAtHome(page);
    await openTower(page);
    await seedTower(page, CHAIN_LINES, CHAIN_EDGES);
    await expect(page.getByTestId("tower-grafo-edge")).toHaveCount(2);

    const cardsBefore = await page.getByTestId("tower-node").count();
    const atRest = await stateChipFont(page, 0);

    // The readable floor is 100%: zoom out is offered and disabled there.
    await expect(page.getByTestId("tower-grafo-zoom-level")).toHaveText("100%");
    await expect(page.getByTestId("tower-grafo-zoom-out")).toBeDisabled();
    await expect(page.getByTestId("tower-grafo-zoom-in")).toBeEnabled();

    const identity = await worldTransform(page);
    await dragCanvas(page, -70, -50);
    await page.getByTestId("tower-grafo-zoom-in").click();
    await page.getByTestId("tower-grafo-zoom-in").click();
    await expect(page.getByTestId("tower-grafo-zoom-level")).toHaveText("144%");
    expect(await worldTransform(page)).not.toBe(identity);

    // Register survives both transforms.
    const moved = await measureRegister(page, 0, 1, 0);
    expect(moved.startDx).toBeLessThanOrEqual(1);
    expect(moved.startDy).toBeLessThanOrEqual(1);
    expect(moved.endDx).toBeLessThanOrEqual(1);
    expect(moved.endDy).toBeLessThanOrEqual(1);

    // No state is lost: the same cards, and the state chip is rendered at least
    // as large as it is at rest (computed size, and the on-screen size, which a
    // transform does scale).
    expect(await page.getByTestId("tower-node").count()).toBe(cardsBefore);
    const magnified = await stateChipFont(page, 0);
    expect(Number.parseFloat(magnified.fontSize)).toBeGreaterThanOrEqual(
      Number.parseFloat(atRest.fontSize),
    );
    expect(magnified.height).toBeGreaterThan(atRest.height);

    // The ceiling is bounded, and the control says so instead of swallowing the
    // press: 144% → 173% → clamped at 200% → disabled.
    await page.getByTestId("tower-grafo-zoom-in").click();
    await expect(page.getByTestId("tower-grafo-zoom-level")).toHaveText("173%");
    await page.getByTestId("tower-grafo-zoom-in").click();
    await expect(page.getByTestId("tower-grafo-zoom-level")).toHaveText("200%");
    await expect(page.getByTestId("tower-grafo-zoom-in")).toBeDisabled();

    // Reset is always there, and brings the world back to identity.
    await page.getByTestId("tower-grafo-zoom-reset").click();
    await expect(page.getByTestId("tower-grafo-zoom-level")).toHaveText("100%");
    await expect(page.getByTestId("tower-grafo-zoom-out")).toBeDisabled();

    // Bounded pan: dragged far past the edge, a slice of the world stays.
    await dragCanvas(page, 900, 400);
    expect(await visibleCardArea(page, 0)).toBeGreaterThan(0);
    await expect(page.getByTestId("tower-grafo-zoom-reset")).toBeVisible();
  });

  test("five widths, three named boxes, register at identity", async ({
    page,
  }) => {
    await bootAtHome(page);
    await openTower(page);
    await seedTower(page, CHAIN_LINES, CHAIN_EDGES);
    await expect(page.getByTestId("tower-grafo-edge")).toHaveCount(2);

    for (const width of ACCEPTANCE_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByTestId("tower-grafo-zoom-reset").click();

      const boxes = await measureBoxes(page);
      expect(
        boxes.b1.scrollWidth,
        `B1 page overflows horizontally at ${width}px`,
      ).toBeLessThanOrEqual(boxes.b1.clientWidth + 1);
      expect(
        boxes.b2.surfaceLeft,
        `B2 surface leaves the column content box at ${width}px`,
      ).toBeGreaterThanOrEqual(boxes.b2.contentLeft - 1);
      expect(
        boxes.b2.surfaceRight,
        `B2 surface leaves the column content box at ${width}px`,
      ).toBeLessThanOrEqual(boxes.b2.contentRight + 1);
      expect(
        boxes.b3.surfaceOffsetWidth,
        `B3 surface is wider than the column content box at ${width}px`,
      ).toBeLessThanOrEqual(boxes.b3.contentWidth + 1);

      const register = await measureRegister(page, 0, 1, 0);
      expect(register.startDx, `start at ${width}px`).toBeLessThanOrEqual(1);
      expect(register.startDy, `start at ${width}px`).toBeLessThanOrEqual(1);
      expect(register.endDx, `end at ${width}px`).toBeLessThanOrEqual(1);
      expect(register.endDy, `end at ${width}px`).toBeLessThanOrEqual(1);
    }
  });

  test("the keyboard walks the cards, pans the focused one in, and a drag does not rebuild them", async ({
    page,
  }) => {
    await bootAtHome(page);
    await openTower(page);
    await seedTower(page, CHAIN_LINES, CHAIN_EDGES);
    // At 800 px the deepest layer starts outside the frame: the keyboard must
    // bring it in, because a transform creates no scroll.
    await page.setViewportSize({ width: 800, height: 900 });
    await page.getByTestId("tower-grafo-zoom-reset").click();

    const last = 2;
    expect(await visibleCardArea(page, last)).toBe(0);

    await page.getByTestId("tower-node").first().click();
    await page.keyboard.press("End");
    await expect(page.getByTestId("tower-node").nth(last)).toBeFocused();
    expect(await visibleCardArea(page, last)).toBeGreaterThan(0);

    // A drag leaves the card DOM nodes themselves in place: identity, not
    // appearance. (A re-render with identical output would also preserve
    // identity — the observable claim is only that the subtree is not rebuilt.)
    await page.evaluate(() => {
      const first = document.querySelector<HTMLElement>(
        '[data-testid="tower-node"]',
      );
      if (first) (first as HTMLElement & { __mark?: string }).__mark = "kept";
    });
    await dragCanvas(page, -40, -30);
    const mark = await page.evaluate(() => {
      const first = document.querySelector<HTMLElement>(
        '[data-testid="tower-node"]',
      );
      return (first as (HTMLElement & { __mark?: string }) | null)?.__mark;
    });
    expect(mark).toBe("kept");
  });

  test("reading, empty and failed edge reads each say their own truth", async ({
    page,
  }) => {
    await bootAtHome(page);
    await openTower(page);
    await seedTower(page, CHAIN_LINES, CHAIN_EDGES);
    await expect(page.getByTestId("tower-grafo-edge")).toHaveCount(2);

    // Reading: no snapshot yet, so nothing is drawn and the layer says so.
    await patchHandoversQuery(page, {
      status: "pending",
      fetchStatus: "fetching",
      data: undefined,
      dataUpdatedAt: 0,
      error: null,
    });
    await expect(page.getByTestId("tower-grafo-edge")).toHaveCount(0);
    await expect(page.getByTestId("tower-grafo-edge-note")).toHaveAttribute(
      "data-tone",
      "loading",
    );

    // Empty: the one reading that may say there are no handoffs.
    await seedQuery(page, HANDOVERS_KEY, []);
    await expect(page.getByTestId("tower-grafo-edge")).toHaveCount(0);
    await expect(page.getByTestId("tower-grafo-edge-note")).toHaveAttribute(
      "data-tone",
      "empty",
    );
    const emptyText = await page
      .getByTestId("tower-grafo-edge-note")
      .textContent();

    // Failed: never painted as the empty reading, and it names the failure.
    await patchHandoversQuery(page, {
      status: "error",
      error: new Error("relay unreachable: request timed out"),
      fetchStatus: "idle",
      data: undefined,
      dataUpdatedAt: 0,
    });
    await expect(page.getByTestId("tower-grafo-edge-note")).toHaveAttribute(
      "data-tone",
      "error",
    );
    await expect(page.getByTestId("tower-grafo-edge-note")).toContainText(
      "edge read failed",
    );
    await expect(page.getByTestId("tower-grafo-edge-note")).not.toHaveText(
      emptyText ?? "",
    );
  });

  test("an empty window keeps the frozen empty state and draws no orphan", async ({
    page,
  }) => {
    await bootAtHome(page);
    await openTower(page);
    // Edges were read, but the portfolio window is empty: there is no node for
    // an endpoint to be an orphan *of*, so no card is invented.
    await seedTower(page, [], [handoff("parent-job", "child-job")]);

    await expect(page.getByTestId("tower-node")).toHaveCount(0);
    await expect(page.getByTestId("tower-grafo-edge")).toHaveCount(0);
    await expect(page.getByTestId("tower-grafo-viewport")).toHaveCount(0);
    // The read is still named, in words and without a figure.
    await expect(page.getByTestId("tower-grafo-no-window-note")).toBeVisible();
  });
});
