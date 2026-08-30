import { createServer, type Server } from "node:http";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { getPublicKey } from "nostr-tools/pure";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

// Phase B: an agent announcing a local dev server gets a card, and pressing it
// frames that server live in the artifact panel.
//
// **The relay-attributed message is the primary case here, because it is the
// only shape production produces.** A relay-side agent does not sign its own
// events: the relay signs and attaches an `actor` tag naming the agent. The
// first production build shipped with the gate reading `signerPubkey` alone,
// so every real card was invisible while this suite stayed green against a
// self-signed mock agent. These tests exist so that cannot recur.
//
// Emitting that shape needs a genuinely signed event — `resolveEventAuthorPubkey`
// honours the `actor` tag only when the signature verifies against the relay's
// NIP-11 identity — hence `signWith` and `relaySelf` below.

// Stands in for the relay's own identity: it signs, and NIP-11 advertises it.
const RELAY_SECRET = new Uint8Array(32).fill(7);
const RELAY_SECRET_HEX = Buffer.from(RELAY_SECRET).toString("hex");
const RELAY_PUBKEY = getPublicKey(RELAY_SECRET);

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

/** Production's shape: the relay signs and attributes authorship to the agent. */
async function announceAsRelayAttributedAgent(page: Page, body: string) {
  await page.evaluate(
    ({ content, agent, secret }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("Mock message emitter is not installed.");
      emit({
        channelName: "general",
        content,
        extraTags: [["actor", agent]],
        signWith: secret,
      });
    },
    {
      content: body,
      agent: TEST_IDENTITIES.alice.pubkey,
      secret: RELAY_SECRET_HEX,
    },
  );
}

/** A locally managed agent that signs its own events. */
async function announceAsSelfSignedAgent(page: Page, body: string) {
  await page.evaluate(
    ({ content, secret }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("Mock message emitter is not installed.");
      emit({ channelName: "general", content, signWith: secret });
    },
    { content: body, secret: TEST_IDENTITIES.alice.privateKey },
  );
}

/** Anyone else typing the sentinel. */
async function announceAsHuman(page: Page, body: string) {
  await page.evaluate(
    ({ content, secret }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("Mock message emitter is not installed.");
      emit({ channelName: "general", content, signWith: secret });
    },
    { content: body, secret: TEST_IDENTITIES.tyler.privateKey },
  );
}

test.beforeEach(async ({ page }) => {
  await startServer();
  await installMockBridge(page, { relaySelf: RELAY_PUBKEY });
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
  await announceAsRelayAttributedAgent(page, `[preview] ${ORIGIN}`);

  const card = page.getByTestId("dev-preview-callout");
  await expect(card).toBeVisible();
  await expect(card).toContainText(ORIGIN);
  // The panel must stay shut until the reader asks for it.
  await expect(page.getByTestId("dev-preview-view")).toHaveCount(0);
});

test("opening the preview loads the live page in the panel", async ({
  page,
}) => {
  await announceAsRelayAttributedAgent(page, `[preview] ${ORIGIN}`);
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
  await announceAsRelayAttributedAgent(page, `[preview] ${ORIGIN}`);
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

test("a self-signed agent is still accepted", async ({ page }) => {
  // The locally managed shape. Both paths must work: the gate accepts a direct
  // signature and a verified relay attribution, and nothing else.
  await announceAsSelfSignedAgent(page, `[preview] ${ORIGIN}`);
  await expect(page.getByTestId("dev-preview-callout")).toBeVisible();
});

test("a human-authored sentinel renders no card", async ({ page }) => {
  await announceAsHuman(page, `[preview] ${ORIGIN}`);
  await expect(page.getByTestId("dev-preview-callout")).toHaveCount(0);
});

test("a non-loopback host renders no card even from an agent", async ({
  page,
}) => {
  await announceAsRelayAttributedAgent(page, "[preview] http://evil.com:39510");
  await expect(page.getByTestId("dev-preview-callout")).toHaveCount(0);
});
