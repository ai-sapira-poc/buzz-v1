import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// I5 — `PLANS/PLAN_SUITE_EVALS_UI_RENDIMIENTO.md`, integration issue
// `cd8af8df7d250327579acffe68cf4a72bf45b7d2a445cb3b33e29582e36120f8`.
//
// I2/I3/I4 built the dashboard behind a component nobody could navigate to
// (`EvalDashboardView` was never mounted on a route — QA and Reviewer flagged
// this on every one of those PRs). This spec is the first one that reaches it
// through the app's real navigation, so it is also the first one that can
// exercise the manual-refresh create/delete-folder cycle (R4, I4's criterion)
// against something a user can actually click to.
//
// Acceptance: reach the evals listing in <=2 clicks from `/agents`, without
// hand-editing the URL.
//
// The app routes on hash history (`src/app/router.tsx`), so the search param
// lives in the fragment (`#/agents?agentsView=evals`), not `location.search`.

type SeedInput = Parameters<
  NonNullable<typeof window.__BUZZ_E2E_SEED_SKILLS__>
>[0];

async function seedSkills(page: Page, input: SeedInput) {
  await page.evaluate((payload) => {
    window.__BUZZ_E2E_SEED_SKILLS__?.(payload);
  }, input);
}

async function gotoApp(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("open-agents-view")).toBeVisible({
    timeout: 15_000,
  });
}

function hashSearchParam(url: string, key: string): string | null {
  const hash = new URL(url).hash; // "#/agents?agentsView=evals"
  const queryIndex = hash.indexOf("?");
  if (queryIndex === -1) return null;
  return new URLSearchParams(hash.slice(queryIndex + 1)).get(key);
}

test("the evals tab is reachable in two clicks from /agents, without editing the URL", async ({
  page,
}) => {
  await installMockBridge(page);
  await gotoApp(page);
  await seedSkills(page, {
    skills: [],
    evals: {
      "agent-builder": {
        dir: "/Users/e2e/.buzz/.agents/evals/agent-builder",
        exists: true,
        cases: [],
        feedback: [],
        bulletin: null,
        discrepancies: [],
      },
    },
  });

  // Click 1: open /agents from the sidebar.
  await page.getByTestId("open-agents-view").click();
  await expect(page.getByTestId("agents-page-content")).toBeVisible();
  expect(hashSearchParam(page.url(), "agentsView")).toBeNull();

  // Click 2: the Evals tab, still on /agents.
  await page.getByTestId("agents-view-mode-tab-evals").click();

  const dashboard = page.getByTestId("eval-dashboard-view");
  await expect(dashboard).toBeVisible();
  await expect(page.getByTestId("agent-eval-card")).toHaveCount(1);

  // Deep-linkable: the tab wrote a search param, not app-internal-only state.
  expect(hashSearchParam(page.url(), "agentsView")).toBe("evals");

  // Switching back to Agents drops the param and the library view returns.
  await page.getByTestId("agents-view-mode-tab-agents").click();
  await expect(page.getByTestId("agents-page-content")).toBeVisible();
  await expect(dashboard).not.toBeVisible();
  expect(hashSearchParam(page.url(), "agentsView")).toBeNull();
});

test("a direct link to ?agentsView=evals opens the dashboard without going through the tab", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/#/agents?agentsView=evals", {
    waitUntil: "domcontentloaded",
  });
  await seedSkills(page, {
    skills: [],
    evals: {
      "agent-builder": {
        dir: "/Users/e2e/.buzz/.agents/evals/agent-builder",
        exists: true,
        cases: [],
        feedback: [],
        bulletin: null,
        discrepancies: [],
      },
    },
  });

  await expect(page.getByTestId("eval-dashboard-view")).toBeVisible();
  await expect(page.getByTestId("agents-view-mode-tab-evals")).toHaveAttribute(
    "data-state",
    "active",
  );
});

test("the previously-blocked I4 criterion, now reachable: create a folder, refresh, it appears; delete it, refresh, it disappears", async ({
  page,
}) => {
  await installMockBridge(page);
  await gotoApp(page);
  await seedSkills(page, {
    skills: [],
    evals: {
      "agent-builder": {
        dir: "/Users/e2e/.buzz/.agents/evals/agent-builder",
        exists: true,
        cases: [],
        feedback: [],
        bulletin: null,
        discrepancies: [],
      },
    },
  });

  await page.getByTestId("open-agents-view").click();
  await page.getByTestId("agents-view-mode-tab-evals").click();
  await expect(page.getByTestId("eval-dashboard-view")).toBeVisible();
  await expect(page.getByTestId("agent-eval-card")).toHaveCount(1);

  // "Create a folder by hand" — simulated by seeding a second folder into
  // the mock bridge, the same substitution I4's own tests used, but now
  // observed through the real route instead of a unit-test render.
  await seedSkills(page, {
    skills: [],
    evals: {
      "agent-builder": {
        dir: "/Users/e2e/.buzz/.agents/evals/agent-builder",
        exists: true,
        cases: [],
        feedback: [],
        bulletin: null,
        discrepancies: [],
      },
      "qa-test-empty-i5": {
        dir: "/Users/e2e/.buzz/.agents/evals/qa-test-empty-i5",
        exists: true,
        cases: [],
        feedback: [],
        bulletin: null,
        discrepancies: [],
      },
    },
  });

  await page.getByTestId("eval-dashboard-refresh").click();
  await expect(page.getByTestId("agent-eval-card")).toHaveCount(2);

  // "Delete it" — drop it back out of the seed.
  await seedSkills(page, {
    skills: [],
    evals: {
      "agent-builder": {
        dir: "/Users/e2e/.buzz/.agents/evals/agent-builder",
        exists: true,
        cases: [],
        feedback: [],
        bulletin: null,
        discrepancies: [],
      },
    },
  });

  await page.getByTestId("eval-dashboard-refresh").click();
  await expect(page.getByTestId("agent-eval-card")).toHaveCount(1);
});
