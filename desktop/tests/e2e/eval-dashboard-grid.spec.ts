import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// N1 — issue `a6762c4864b4c705a0856083987aca0ff88d104c4d014cbf4b088aa642be10cd`,
// criterion CR-11 of `DESIGN/suite-evals-ui-rendimiento/SPEC.md` (`db41e15`).
//
// The grid in `EvalDashboardView` styles its columns with `@container` queries,
// but no ancestor in the Evals chain declared a containment context, so the
// queries never matched and the cards stacked in a single column at any width.
// The fix declares `[container-type:inline-size]` on the `max-w-6xl` wrapper —
// the same line `AgentsView.tsx` already uses in the sibling tab.
//
// These assertions are on rendered layout rather than on the class list: a
// container query that does not resolve produces exactly the visual bug this
// issue fixes, and only the computed track list can tell the two apart.

type SeedInput = Parameters<
  NonNullable<typeof window.__BUZZ_E2E_SEED_SKILLS__>
>[0];

function mockEvals(slug: string) {
  return {
    dir: `/Users/e2e/.buzz/.agents/evals/${slug}`,
    exists: true,
    cases: [],
    feedback: [],
    bulletin: null,
    discrepancies: [],
  };
}

async function seedThreeAgents(page: Page) {
  const evals: NonNullable<SeedInput["evals"]> = {};
  for (const slug of ["ana-soporte", "texter", "pm"]) {
    evals[slug] = mockEvals(slug);
  }
  // The seed hook is installed by the app bundle, not by the document: seeding
  // on `domcontentloaded` races it, and the optional call silently no-ops when
  // it loses. Waiting for the hook is what makes this deterministic.
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_SEED_SKILLS__ === "function",
    undefined,
    { timeout: 15_000 },
  );
  await page.evaluate(
    (payload) => {
      window.__BUZZ_E2E_SEED_SKILLS__?.(payload);
    },
    { skills: [], evals } satisfies SeedInput,
  );
}

async function openDashboard(page: Page) {
  await installMockBridge(page);
  await page.goto("/#/agents?agentsView=evals", {
    waitUntil: "domcontentloaded",
  });
  await seedThreeAgents(page);
  await expect(page.getByTestId("eval-dashboard-view")).toBeVisible({
    timeout: 15_000,
  });
  return page.getByTestId("eval-dashboard-grid");
}

async function trackCount(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="eval-dashboard-grid"]');
    if (!grid) throw new Error("eval-dashboard-grid not rendered");
    const columns = getComputedStyle(grid).gridTemplateColumns.trim();
    return columns.split(/\s+/).filter(Boolean).length;
  });
}

test("CR-11: at 2360px the grid resolves to three columns with a 12px gap", async ({
  page,
}) => {
  await page.setViewportSize({ width: 2360, height: 1200 });
  const grid = await openDashboard(page);
  await expect(grid).toBeVisible();

  // Three tracks, not "wide enough to fit three cards": without a containment
  // context the class stays `grid-cols-1` and this is 1 at any viewport.
  expect(await trackCount(page)).toBe(3);

  const gaps = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="eval-dashboard-grid"]');
    const style = getComputedStyle(grid as Element);
    return { column: style.columnGap, row: style.rowGap };
  });
  expect(gaps).toEqual({ column: "12px", row: "12px" });
});

test("CR-11: at 390px the same grid resolves to a single column", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const grid = await openDashboard(page);
  await expect(grid).toBeVisible();

  expect(await trackCount(page)).toBe(1);
});
