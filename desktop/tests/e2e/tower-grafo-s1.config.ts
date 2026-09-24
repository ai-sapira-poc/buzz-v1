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

// This file lives in `tests/e2e/`; the build output and the served port belong
// to `desktop/`. Resolving from the config's own URL keeps the path independent
// of where the runner is invoked from (Playwright loads this as an ES module,
// so there is no `__dirname`).
const desktopRoot = fileURLToPath(new URL("../../", import.meta.url));

// One port per checkout, not one port shared by every checkout.
//
// Several worktrees of this repo run this runner at once — the harness gives
// each agent its own — and `reuseExistingServer` is false precisely so a run
// never exercises another checkout's `dist`. A single fixed port turns a
// concurrent sibling run into a hard bind failure ("…is already used") that
// reads like a defect in this spec, observed four times while validating it.
// Deriving the port from the checkout path keeps the invariant by
// construction; `BUZZ_TOWER_GRAFO_PORT` pins it when a caller needs a known
// port, the same override `playwright.release-smoke.config.ts` offers.
const PORT_BASE = 4300;
const PORT_SPAN = 400;

function checkoutPort(root: string): number {
  let hash = 0;
  for (const char of root) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % PORT_SPAN;
  }
  return PORT_BASE + hash;
}

const port = Number(
  process.env.BUZZ_TOWER_GRAFO_PORT ?? checkoutPort(desktopRoot),
);
const url = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: ["tower-grafo-s1.spec.ts"],
  timeout: 90_000,
  // One retry locally, two in CI — a net for the shared mock harness, not for
  // this surface.
  //
  // The boot flake that motivated it was the web server's listen backlog
  // dropping connections (see `request_queue_size` below): the shell never
  // mounted, and every failing run failed at `open-tower-view` before any
  // grafo assertion ran. That cause is fixed, and with it fixed the suite has
  // run clean without a retry; retries stay only because the app-shell gate
  // (`community.isReady`) is shared with every other mock spec in this repo
  // and a genuine harness-level transient should not fail the stage. They
  // remain visible in the report as `flaky`, so nothing is hidden.
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
    // The suite runs its own server rather than `python3 -m http.server` so it
    // can size the listen backlog (below). `python3 -m http.server` is already
    // threaded — `http.server.__main__` uses `ThreadingHTTPServer` — but it
    // inherits the stdlib backlog of 5, and against the same 76 concurrent
    // module requests it reset 38-64 of them per run, so it would reproduce
    // the flake this runner exists to avoid.
    //
    // `request_queue_size` is the listen(2) backlog. `socketserver.TCPServer`
    // defaults it to 5, which is smaller than the connection burst the built
    // app opens: `dist/index.html` modulepreloads 75 chunks at once and every
    // response is HTTP/1.0 `Connection: close`, so Chromium opens a fresh
    // socket per asset. Past the backlog the kernel refuses the extra SYN and
    // resets the connection; a module request that fails aborts the whole
    // module graph, so the app never mounts and the boot wait expires — the
    // observed flake was exactly that (`ERR_CONNECTION_RESET` in the console,
    // an empty `#root`, then 45s of waiting for a shell that never renders).
    //
    // Measured against this server, firing the 76 index.html requests
    // concurrently: backlog 5 reset 31-51 of them on every run, backlog 512
    // reset 0 across three runs. Separately, deleting one modulepreloaded
    // chunk from an otherwise intact `dist` left `#root` empty for 15s on
    // backlog 512, which is the second half of the chain.
    command: `python3 -c "import functools, http.server, socketserver; socketserver.ThreadingTCPServer.allow_reuse_address = True; socketserver.ThreadingTCPServer.request_queue_size = 512; socketserver.ThreadingTCPServer(('127.0.0.1', ${port}), functools.partial(http.server.SimpleHTTPRequestHandler, directory=r'${path.join(desktopRoot, "dist")}')).serve_forever()"`,
    cwd: desktopRoot,
    // Never reuse: a server already on this port would be serving *another*
    // checkout's `dist`, and the spec would silently exercise someone else's
    // build.
    reuseExistingServer: false,
    url,
  },
});
