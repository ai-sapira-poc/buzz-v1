import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Milestone A1 of the artifact preview panel: an HTML or SVG attachment gains a
// Preview action that docks the right-hand panel and renders the file in a
// sandboxed frame, with a Source tab beside it.
//
// The frame is inert by design in A1 — a `srcdoc` document inherits the app's
// `script-src 'self'`, so an artifact's own scripts never run. That is measured,
// not assumed: see docs/spike-csp-results.md §3. The panel says so out loud
// whenever the source carries a <script>, because otherwise a script-driven
// artifact just looks broken.

const HEX = "a".repeat(64);
const HTML_URL = `https://mock.relay/media/${HEX}.html`;
// SVG uploads sniff as application/octet-stream (`infer` has no SVG matcher),
// so the stored extension is .bin and the filename is the only signal.
const SVG_URL = `https://mock.relay/media/${"b".repeat(64)}.bin`;
const PDF_URL = `https://mock.relay/media/${"c".repeat(64)}.pdf`;

const HTML_BODY = `<!doctype html><html><body><h1>Build report</h1><script>document.title="ran"</script></body></html>`;
const SVG_BODY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#036"/></svg>`;

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

/** Serve the artifact bytes: the mock bridge's fetch_media_bytes uses page fetch. */
async function routeArtifacts(page: Page) {
  await page.route(HTML_URL, (route) =>
    route.fulfill({ body: HTML_BODY, contentType: "text/html" }),
  );
  await page.route(SVG_URL, (route) =>
    route.fulfill({ body: SVG_BODY, contentType: "application/octet-stream" }),
  );
}

function imeta(url: string, mime: string, filename: string, size: number) {
  return [
    "imeta",
    `url ${url}`,
    `m ${mime}`,
    `filename ${filename}`,
    `size ${size}`,
  ];
}

async function seedAttachments(page: Page) {
  await page.evaluate(
    ({ htmlUrl, svgUrl, pdfUrl, tags }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("Mock message emitter is not installed.");
      emit({
        channelName: "general",
        content: `[report.html](${htmlUrl})`,
        extraTags: [tags.html],
      });
      emit({
        channelName: "general",
        content: `[diagram.svg](${svgUrl})`,
        extraTags: [tags.svg],
      });
      emit({
        channelName: "general",
        content: `[quarterly.pdf](${pdfUrl})`,
        extraTags: [tags.pdf],
      });
    },
    {
      htmlUrl: HTML_URL,
      svgUrl: SVG_URL,
      pdfUrl: PDF_URL,
      tags: {
        html: imeta(HTML_URL, "text/html", "report.html", HTML_BODY.length),
        svg: imeta(
          SVG_URL,
          "application/octet-stream",
          "diagram.svg",
          SVG_BODY.length,
        ),
        pdf: imeta(PDF_URL, "application/pdf", "quarterly.pdf", 4096),
      },
    },
  );
}

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
  await routeArtifacts(page);
  await page.goto("/");
  // `/` lands on the Inbox; the timeline under test lives in the channel, and
  // the live subscription only starts once it is open.
  await page.getByTestId("channel-general").click();
  await waitForMockLiveSubscription(page, "general");
  await seedAttachments(page);
});

function cardFor(page: Page, filename: string) {
  return page.getByTestId("file-card").filter({ hasText: filename });
}

test("previewable attachments expose a Preview action, others do not", async ({
  page,
}) => {
  await expect(cardFor(page, "report.html")).toBeVisible();
  await expect(
    cardFor(page, "report.html").getByTestId("file-card-preview"),
  ).toBeVisible();
  await expect(
    cardFor(page, "diagram.svg").getByTestId("file-card-preview"),
  ).toBeVisible();

  // A plain download must not gain the action.
  await expect(cardFor(page, "quarterly.pdf")).toBeVisible();
  await expect(
    cardFor(page, "quarterly.pdf").getByTestId("file-card-preview"),
  ).toHaveCount(0);
});

test("clicking Preview docks the panel and renders the artifact", async ({
  page,
}) => {
  await cardFor(page, "report.html").getByTestId("file-card-preview").click();

  const panel = page.getByTestId("idle-auxiliary-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("report.html");

  const frame = page.getByTestId("artifact-frame");
  await expect(frame).toBeVisible();
  await expect(frame.contentFrame().locator("h1")).toHaveText("Build report");
});

test("the frame is sandboxed and never same-origin", async ({ page }) => {
  await cardFor(page, "report.html").getByTestId("file-card-preview").click();

  const frame = page.getByTestId("artifact-frame");
  // Exact match, not a substring check: `allow-same-origin` would hand
  // attacker-supplied markup the user's relay session.
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
});

test("a script-bearing artifact is called out as static", async ({ page }) => {
  await cardFor(page, "report.html").getByTestId("file-card-preview").click();

  await expect(page.getByTestId("artifact-script-notice")).toBeVisible();
});

// NOTE — this suite cannot assert that the artifact's scripts stay unexecuted.
// The CSP that makes a `srcdoc` frame inert is injected by Tauri at runtime;
// under Playwright the app is served by a plain preview server with no such
// header, so the frame's inline script DOES run here (verified: it sets
// document.title to "ran"). Inertness is a production property, measured on a
// real WKWebView in docs/spike-csp-results.md §3 — not something this harness
// can stand behind.
//
// What survives in every environment, and is asserted above, is the sandbox
// attribute: with no `allow-same-origin` the frame holds an opaque origin, so
// artifact script — running or not — can never reach the user's session.

test("Source tab shows the raw markup", async ({ page }) => {
  await cardFor(page, "report.html").getByTestId("file-card-preview").click();

  await page.getByTestId("artifact-tab-source").click();
  await expect(page.getByTestId("artifact-source")).toContainText(
    "<h1>Build report</h1>",
  );
  await expect(page.getByTestId("artifact-frame")).toHaveCount(0);
});

test("SVG renders through the same path", async ({ page }) => {
  await cardFor(page, "diagram.svg").getByTestId("file-card-preview").click();

  const panel = page.getByTestId("idle-auxiliary-panel");
  await expect(panel).toContainText("diagram.svg");
  await expect(
    page.getByTestId("artifact-frame").contentFrame().locator("svg rect"),
  ).toBeVisible();

  // No script in the source, so no notice.
  await expect(page.getByTestId("artifact-script-notice")).toHaveCount(0);
});

test("closing the panel restores the channel", async ({ page }) => {
  await cardFor(page, "report.html").getByTestId("file-card-preview").click();
  const panel = page.getByTestId("idle-auxiliary-panel");
  await expect(panel).toBeVisible();

  await panel.getByRole("button", { name: /close/i }).first().click();
  await expect(panel).toHaveCount(0);
});
