import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

/**
 * The stage's own runner.
 *
 * `desktop/tests/e2e/tower-grafo-s1.spec.ts` is deliberately not registered in
 * `playwright.config.ts`: this stage may only write inside
 * `desktop/tests/e2e/tower-grafo-*`, and a spec that no project's `testMatch`
 * lists is collected by nothing — not even when its path is passed on the
 * command line. So the runner travels with the spec, the way
 * `playwright.release-smoke.config.ts` already does for the release-smoke lane:
 *
 *     pnpm build:e2e
 *     npx playwright test --config=tests/e2e/tower-grafo-s1.config.ts
 *
 * Registering it in the shared config is a one-line follow-up for whoever owns
 * that file.
 */

// This file lives in `tests/e2e/`; the build output and the pinned port belong
// to `desktop/`. Resolving from the config's own URL keeps the path independent
// of where the runner is invoked from (Playwright loads this as an ES module,
// so there is no `__dirname`).
const desktopRoot = fileURLToPath(new URL("../../", import.meta.url));
const port = 4173;
const url = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: ["tower-grafo-s1.spec.ts"],
  timeout: 90_000,
  // One retry locally, two in CI.
  //
  // The observed flake is the app shell never mounting its sidebar on a host
  // under heavy load (a run that takes 10s idle takes 40s-2m loaded, and a
  // boot wait then expires before the shell mounts). It is not this surface:
  // every failing run so far failed at `open-tower-view` before any grafo
  // assertion ran, and the same boot gate is shared with every other spec in
  // this repo. Retries stay visible in the report as `flaky`, so the flake is
  // reported rather than hidden.
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: url,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    // `python3 -m http.server` is single-threaded: one keep-alive socket left
    // open by an earlier test wedges every later asset request and the app
    // never boots. The suite loads the whole app per test, so the server the
    // suite starts is the threaded one.
    command: `python3 -c "import functools, http.server, socketserver; socketserver.ThreadingTCPServer.allow_reuse_address = True; socketserver.ThreadingTCPServer(('127.0.0.1', ${port}), functools.partial(http.server.SimpleHTTPRequestHandler, directory=r'${path.join(desktopRoot, "dist")}')).serve_forever()"`,
    cwd: desktopRoot,
    // Never reuse: a server already on this port would be serving *another*
    // checkout's `dist`, and the spec would silently exercise someone else's
    // build.
    reuseExistingServer: false,
    url,
  },
});
