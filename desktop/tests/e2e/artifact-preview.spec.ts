import { readFileSync } from "node:fs";

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

test("the panel is a resizable docked pane, not a focus drawer", async ({
  page,
}) => {
  // Regression guard for the A1 manual-verification failure: the panel used to
  // land in FocusThreadDrawer, which renders no resize handle at all, so the
  // left edge had no drag affordance. The docked pane owns the handle.
  await cardFor(page, "report.html").getByTestId("file-card-preview").click();
  await expect(page.getByTestId("idle-auxiliary-panel")).toBeVisible();

  const handle = page.getByTestId("right-auxiliary-pane-resize-handle");
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute("aria-label", "Resize panel");
});

test("dragging the handle actually changes the panel width", async ({
  page,
}) => {
  await cardFor(page, "report.html").getByTestId("file-card-preview").click();
  const panel = page.getByTestId("idle-auxiliary-panel");
  await expect(panel).toBeVisible();

  const before = (await panel.boundingBox())?.width ?? 0;
  const handle = page.getByTestId("right-auxiliary-pane-resize-handle");
  const box = await handle.boundingBox();
  if (!box) throw new Error("resize handle has no box");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 160, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();

  const after = (await panel.boundingBox())?.width ?? 0;
  // Dragging the left edge leftwards widens the right-hand pane.
  expect(after).toBeGreaterThan(before + 40);
});

// --- A2: the artifact:// renderer and its opt-in gate ---
//
// The artifact scheme is a Tauri protocol, so a browser-based harness cannot
// load the trusted frame or probe isolation from inside it. What it can prove
// is the gate: scripts stay unrun until the reader asks, and the switch targets
// the isolated origin rather than widening the inert one. The frame's own
// isolation (parent, storage, network) is enforced by the response CSP, which
// the Rust suite pins, and was measured on WKWebView in
// docs/spike-csp-results.md §5.

test("a script-bearing artifact offers to run, and does not run first", async ({
  page,
}) => {
  await cardFor(page, "report.html").getByTestId("file-card-preview").click();

  await expect(page.getByTestId("artifact-run")).toBeVisible();
  await expect(page.getByTestId("artifact-frame")).toHaveAttribute(
    "data-artifact-mode",
    "inert",
  );
  await expect(page.getByTestId("artifact-running-notice")).toHaveCount(0);
});

test("opting in switches the frame to the isolated artifact origin", async ({
  page,
}) => {
  await cardFor(page, "report.html").getByTestId("file-card-preview").click();
  await page.getByTestId("artifact-run").click();

  const frame = page.getByTestId("artifact-frame");
  await expect(frame).toHaveAttribute("data-artifact-mode", "trusted");
  const src = await frame.getAttribute("src");
  expect(src).toMatch(/^artifact:\/\/localhost\/[0-9a-f]{64}$/);

  // Still no allow-same-origin, in the mode where scripts actually execute.
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(page.getByTestId("artifact-running-notice")).toBeVisible();
  await expect(page.getByTestId("artifact-run")).toHaveCount(0);
});

test("an artifact without scripts is never offered the run gate", async ({
  page,
}) => {
  await cardFor(page, "diagram.svg").getByTestId("file-card-preview").click();
  await expect(page.getByTestId("artifact-frame")).toBeVisible();
  await expect(page.getByTestId("artifact-run")).toHaveCount(0);
});

test("trust does not survive switching to another artifact", async ({
  page,
}) => {
  await cardFor(page, "report.html").getByTestId("file-card-preview").click();
  await page.getByTestId("artifact-run").click();
  await expect(page.getByTestId("artifact-frame")).toHaveAttribute(
    "data-artifact-mode",
    "trusted",
  );

  await cardFor(page, "diagram.svg").getByTestId("file-card-preview").click();
  await cardFor(page, "report.html").getByTestId("file-card-preview").click();

  await expect(page.getByTestId("artifact-frame")).toHaveAttribute(
    "data-artifact-mode",
    "inert",
  );
  await expect(page.getByTestId("artifact-run")).toBeVisible();
});

// The sandbox half of the isolation contract IS testable here, and worth
// automating: this harness has no CSP, so the inert frame's scripts execute,
// which lets the real fixture run its escape attempts against the same
// `sandbox="allow-scripts"` boundary production uses. The network probes are
// expected to pass through here — only the response CSP blocks those, and that
// CSP exists solely on the artifact:// scheme the browser cannot load.
test("the sandbox denies the fixture's escape attempts", async ({ page }) => {
  const fixture = readFileSync(
    new URL("../../../test-fixtures/sondas.html", import.meta.url),
    "utf8",
  );
  const url = `https://mock.relay/media/${"d".repeat(64)}.html`;
  await page.route(url, (route) =>
    route.fulfill({ body: fixture, contentType: "text/html" }),
  );

  await page.evaluate(
    ({ href, tag }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("Mock message emitter is not installed.");
      emit({
        channelName: "general",
        content: `[sondas.html](${href})`,
        extraTags: [tag],
      });
    },
    {
      href: url,
      tag: imeta(url, "text/html", "sondas.html", fixture.length),
    },
  );

  await cardFor(page, "sondas.html").getByTestId("file-card-preview").click();
  const frame = page.getByTestId("artifact-frame").contentFrame();

  await expect(frame.locator("#verdict")).not.toHaveText(/NOT FRAMED/);

  for (const probe of [
    "Read parent document",
    "Read parent location",
    "Read top window origin",
    "localStorage",
    "sessionStorage",
    "Opaque origin",
  ]) {
    await expect(
      frame.locator("li").filter({ hasText: probe }).locator(".tag"),
      `${probe} must be blocked by the frame sandbox`,
    ).toHaveText("BLOCKED");
  }
});

test("closing the panel restores the channel", async ({ page }) => {
  await cardFor(page, "report.html").getByTestId("file-card-preview").click();
  const panel = page.getByTestId("idle-auxiliary-panel");
  await expect(panel).toBeVisible();

  await panel.getByRole("button", { name: /close/i }).first().click();
  await expect(panel).toHaveCount(0);
});
