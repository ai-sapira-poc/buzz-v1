import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/** The profile card opens a menu; Settings is an item inside it. */
async function openSettings(page: Page) {
  await page.getByTestId("open-settings").click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
}

// Two builds of this app are otherwise indistinguishable — same name, same
// icon, same version — which is how a stale instance ends up in the foreground
// during manual verification. These surfaces exist to make "which build is
// this?" answerable without leaving the window.

// The app has no persistent brand mark to hover — the bee only appears on
// loading gates — so the stamp lives where someone looks for a version anyway,
// with the full detail on hover.
test("settings shows version, commit and build time", async ({ page }) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page);

  const stamp = page.getByTestId("settings-version");
  await expect(stamp).toBeVisible();
  await expect(stamp).toContainText("v9.9.9");
  await expect(stamp).toContainText("abcdef123456");
});

test("the stamp carries the full build identity on hover", async ({ page }) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page);

  const tooltip = await page
    .getByTestId("settings-version")
    .getAttribute("title");
  expect(tooltip).toContain("Buzz 9.9.9");
  expect(tooltip).toContain("commit abcdef123456");
  expect(tooltip).toContain("built ");
});

test("stubbed sidecars are announced at startup, not at first use", async ({
  page,
}) => {
  await installMockBridge(page, {
    stubbedSidecars: ["buzz-agent", "buzz-acp"],
  });
  await page.goto("/");

  const toast = page.getByText("Agent features are unavailable in this build");
  await expect(toast).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/buzz-agent, buzz-acp/)).toBeVisible();
});

test("a healthy build says nothing", async ({ page }) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.waitForTimeout(1500);
  await expect(
    page.getByText("Agent features are unavailable in this build"),
  ).toHaveCount(0);
});
