import { createServer, type Server } from "node:http";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

// Phase B: an agent announcing a local dev server gets a card, and pressing it
// frames that server live in the artifact panel.
//
// `alice` is a default mock relay agent, so a message emitted under her pubkey
// carries a signerPubkey inside the known-agent baseline — which is exactly
// what the card's gate requires. Emitting under a non-agent pubkey is the
// negative case, and it must render nothing.

const PORT = 39510;
const ORIGIN = `http://localhost:${PORT}`;
const PAGE_MARKER = "DEV-SERVER-PAGE";

let server: Server | null = null;

async function startServer() {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><body><h1>${PAGE_MARKER}</h1></body>`);
  });
  await new Promise<void>((resolve) =>
    server?.listen(PORT, "127.0.0.1", resolve),
  );
}

async function stopServer() {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
}

async function waitForMockLiveSubscription(page: Page, channelName: string) {
  await expect
    .poll(() =>
      page.evaluate(
        (name) =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: name,
          }) ?? false,
        channelName,
      ),
    )
    .toBe(true);
}

async function announce(page: Page, body: string, pubkey?: string) {
  await page.evaluate(
    ({ content, author }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("Mock message emitter is not installed.");
      emit({
        channelName: "general",
        content,
        ...(author ? { pubkey: author } : {}),
      });
    },
    { content: body, author: pubkey },
  );
}

test.beforeEach(async ({ page }) => {
  await startServer();
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await waitForMockLiveSubscription(page, "general");
});

test.afterEach(async () => {
  await stopServer();
});

test("an agent's sentinel renders a card, and nothing loads until it is pressed", async ({
  page,
}) => {
  await announce(page, `[preview] ${ORIGIN}`, TEST_IDENTITIES.alice.pubkey);

  const card = page.getByTestId("dev-preview-callout");
  await expect(card).toBeVisible();
  await expect(card).toContainText(ORIGIN);
  // The panel must stay shut until the reader asks for it.
  await expect(page.getByTestId("dev-preview-view")).toHaveCount(0);
});

test("opening the preview loads the live page in the panel", async ({
  page,
}) => {
  await announce(page, `[preview] ${ORIGIN}`, TEST_IDENTITIES.alice.pubkey);
  await page.getByTestId("dev-preview-open").click();

  await expect(page.getByTestId("dev-preview-url")).toHaveText(ORIGIN);
  const frame = page.getByTestId("dev-preview-frame");
  await expect(frame).toBeVisible({ timeout: 15_000 });
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-forms");
  await expect(frame.contentFrame().locator("h1")).toHaveText(PAGE_MARKER);
});

test("a stopped server shows the error state, and retry recovers it", async ({
  page,
}) => {
  await announce(page, `[preview] ${ORIGIN}`, TEST_IDENTITIES.alice.pubkey);
  await page.getByTestId("dev-preview-open").click();
  await expect(page.getByTestId("dev-preview-frame")).toBeVisible({
    timeout: 15_000,
  });

  await stopServer();
  await page.getByTestId("dev-preview-reload").click();
  await expect(page.getByTestId("dev-preview-error")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("dev-preview-error")).toContainText(
    `localhost:${PORT}`,
  );

  await startServer();
  await page.getByTestId("dev-preview-retry").click();
  await expect(page.getByTestId("dev-preview-frame")).toBeVisible({
    timeout: 15_000,
  });
});

test("a human-authored sentinel renders no card", async ({ page }) => {
  await announce(page, `[preview] ${ORIGIN}`, TEST_IDENTITIES.tyler.pubkey);
  await expect(page.getByTestId("dev-preview-callout")).toHaveCount(0);
});

test("a non-loopback host renders no card even from an agent", async ({
  page,
}) => {
  await announce(
    page,
    "[preview] http://evil.com:39510",
    TEST_IDENTITIES.alice.pubkey,
  );
  await expect(page.getByTestId("dev-preview-callout")).toHaveCount(0);
});
