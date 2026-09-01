import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// N3 — issue `845d0093a23896801abeeb35424b085eb88c31f579761637ad58f4b8c3a1950d`,
// criteria CR-1..CR-10 of `DESIGN/suite-evals-ui-rendimiento/SPEC.md` (db41e15).
//
// Everything here is measured on computed style rather than on class lists.
// A class list says what was written; the criteria are about what renders, and
// the two come apart exactly where these criteria live — an alpha that does not
// composite, a token that resolves to the wrong colour, a container query that
// never matches.
//
// Five of the ten criteria were already satisfied by `origin/main` (CR-1, CR-4,
// CR-6, CR-9, CR-10). They are asserted anyway: a criterion that already holds
// is one that has to keep holding.

type SeedInput = Parameters<
  NonNullable<typeof window.__BUZZ_E2E_SEED_SKILLS__>
>[0];

const SCORED = "ana-soporte";
const UNSCORED = "agent-builder";

function evalsFor(slug: string, withBulletin: boolean) {
  return {
    dir: `/Users/e2e/.buzz/.agents/evals/${slug}`,
    exists: true,
    cases: [],
    feedback: [],
    bulletin: withBulletin
      ? {
          date: "2026-08-29",
          runner: "manual",
          score: "0.75",
          trend: "sube",
          rows: [],
          problems: [],
        }
      : null,
    discrepancies: [],
  };
}

async function openDashboard(page: Page) {
  await installMockBridge(page);
  await page.goto("/#/agents?agentsView=evals", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_SEED_SKILLS__ === "function",
    undefined,
    { timeout: 15_000 },
  );
  await page.evaluate(
    (payload) => {
      window.__BUZZ_E2E_SEED_SKILLS__?.(payload);
    },
    {
      skills: [],
      evals: {
        [SCORED]: evalsFor(SCORED, true),
        [UNSCORED]: evalsFor(UNSCORED, false),
      },
    } satisfies SeedInput,
  );
  await expect(page.getByTestId("eval-dashboard-view")).toBeVisible({
    timeout: 15_000,
  });
}

/** Relative luminance per WCAG 2.x, on already-composited sRGB. */
function contrastScript() {
  return (selector: string) => {
    const node = document.querySelector(selector);
    if (!node) throw new Error(`missing node: ${selector}`);

    // Chromium serialises theme colours as `oklab(...)`, not `rgb(...)`.
    // Reading those four numbers as if they were RGB is how a legible grey
    // measures as 2.89:1 — the parser has to convert, not assume.
    const parse = (value: string) => {
      const nums = (value.match(/-?[\d.]+/g) ?? []).map(Number);
      if (nums.length < 3) throw new Error(`unparseable colour: ${value}`);
      const a = nums.length > 3 ? nums[3] : 1;
      if (!value.startsWith("oklab")) {
        return { r: nums[0], g: nums[1], b: nums[2], a };
      }
      const [L, A, B] = nums;
      const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
      const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
      const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
      const lin = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
      ];
      const enc = (c: number) => {
        const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
        return Math.min(255, Math.max(0, v * 255));
      };
      return { r: enc(lin[0]), g: enc(lin[1]), b: enc(lin[2]), a };
    };

    // Walk up for the first opaque background: the criterion asks for the
    // *real* backdrop, and `bg-muted/50` over the page is not `--muted`.
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    const layers: { r: number; g: number; b: number; a: number }[] = [];
    for (let el: Element | null = node; el; el = el.parentElement) {
      const c = parse(getComputedStyle(el).backgroundColor);
      if (c.a > 0) layers.unshift(c);
      if (c.a === 1) {
        bg = c;
        break;
      }
    }
    let composited = bg;
    for (const layer of layers) {
      composited = {
        r: layer.r * layer.a + composited.r * (1 - layer.a),
        g: layer.g * layer.a + composited.g * (1 - layer.a),
        b: layer.b * layer.a + composited.b * (1 - layer.a),
        a: 1,
      };
    }

    const fg = parse(getComputedStyle(node).color);
    const over = {
      r: fg.r * fg.a + composited.r * (1 - fg.a),
      g: fg.g * fg.a + composited.g * (1 - fg.a),
      b: fg.b * fg.a + composited.b * (1 - fg.a),
    };

    const lum = (c: { r: number; g: number; b: number }) => {
      const chan = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
    };
    const a = lum(over);
    const b = lum(composited);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return Math.round(ratio * 100) / 100;
  };
}

test("CR-1/CR-4: the panel takes colour from theme tokens, with no --chart-* and no nine-slice texture", async ({
  page,
}) => {
  await openDashboard(page);

  // CR-1's stated check ("`getComputedStyle(:root)` returns empty") describes
  // the prototype, which never loads the startup sheet. In the fork the
  // variables DO resolve — and to fixed Catppuccin values that do not follow
  // the theme, which is precisely the reason the criterion bans them. So the
  // assertion is the prohibition itself: nothing in this panel may resolve its
  // colour through `--chart-*`. Reported to the Delivery Lead.
  const usesChartVars = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="eval-dashboard-view"]');
    if (!panel) throw new Error("panel not rendered");
    return Array.from(panel.querySelectorAll("*")).filter((el) =>
      /var\(\s*--chart-/.test(el.getAttribute("style") ?? ""),
    ).length;
  });
  expect(usesChartVars).toBe(0);

  // Control: the variables are not empty in this build, so the check above is
  // measuring use and not accidental absence.
  const chartVars = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--chart-1")
      .trim(),
  );
  expect(chartVars).not.toBe("");

  // CR-4 — the texture belongs to onboarding, not to an internal data panel.
  const textured = await page
    .getByTestId("eval-dashboard-view")
    .locator('[data-variant="textured"], .textured')
    .count();
  expect(textured).toBe(0);
});

test("CR-2/CR-3: the card is a 16px filled surface whose hover moves fill and border, never position", async ({
  page,
}) => {
  await openDashboard(page);
  const card = page.getByTestId("agent-eval-card").first();
  await expect(card).toBeVisible();

  const rest = await card.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      radius: s.borderTopLeftRadius,
      transform: s.transform,
      background: s.backgroundColor,
      shadow: s.boxShadow,
    };
  });
  expect(rest.radius).toBe("16px");
  expect(rest.transform).toBe("none");
  // Filled, not white-on-white: the alpha layer has to be actually painted.
  expect(rest.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(rest.shadow).not.toBe("none");

  // Measured with transitions off. `transition-colors` means the computed
  // background during the animation is an intermediate frame, so a hover that
  // does change the fill reads as one that does not.
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; }",
  });
  await card.hover();
  const hovered = await card.evaluate((el) => {
    const s = getComputedStyle(el);
    return { transform: s.transform, background: s.backgroundColor };
  });
  // CR-3 — the hover is allowed to move fill and border. It is not allowed to
  // move the card: `transform` stays `none` on both sides of the interaction.
  expect(hovered.transform).toBe("none");
  expect(hovered.background).not.toBe(rest.background);
});

test("CR-5: secondary text clears WCAG AA against its real, composited backdrop", async ({
  page,
}) => {
  await openDashboard(page);
  await expect(page.getByTestId("agent-eval-card").first()).toBeVisible();

  const ratio = await page.evaluate(
    contrastScript(),
    '[data-testid="agent-eval-card-no-bulletin"]',
  );
  expect(ratio).toBeGreaterThanOrEqual(4.5);

  // Control: the same measurement on the primary text must be higher still.
  // Without it, a bug that returned a constant would pass the assertion above.
  const primary = await page.evaluate(
    contrastScript(),
    '[data-testid="eval-dashboard-view"] h1',
  );
  expect(primary).toBeGreaterThan(ratio);
});

test("CR-7/CR-8: the score outweighs the agent name, and a missing score is never a digit", async ({
  page,
}) => {
  await openDashboard(page);

  const sizes = await page.evaluate(
    ({ scored, unscored }) => {
      const card = (dir: string) =>
        document.querySelector(`[data-agent-dir="${dir}"]`);
      const px = (el: Element | null) =>
        el ? Number.parseFloat(getComputedStyle(el).fontSize) : null;
      const scoredCard = card(scored);
      const unscoredCard = card(unscored);
      return {
        score: px(
          scoredCard?.querySelector('[data-testid="agent-eval-card-score"]') ??
            null,
        ),
        name: px(scoredCard?.querySelector("p") ?? null),
        na: px(
          unscoredCard?.querySelector(
            '[data-testid="agent-eval-card-no-bulletin"]',
          ) ?? null,
        ),
        naText:
          unscoredCard
            ?.querySelector('[data-testid="agent-eval-card-no-bulletin"]')
            ?.textContent?.trim() ?? "",
      };
    },
    { scored: SCORED, unscored: UNSCORED },
  );

  expect(sizes.score).toBe(18);
  expect(sizes.name).toBe(14);
  expect(sizes.score).toBeGreaterThan(sizes.name as number);

  // CR-8 — deliberately smaller, and never a number: no fake zero.
  expect(sizes.na).toBe(11);
  expect(sizes.naText).toBe("n/a");
  expect(sizes.naText).not.toMatch(/[0-9]/);
});

test("CR-9/CR-10: the header ramp is 24px over base, and the detail blocks share one surface", async ({
  page,
}) => {
  await openDashboard(page);

  const heading = await page.evaluate(() => {
    const h1 = document.querySelector(
      '[data-testid="eval-dashboard-view"] h1',
    ) as HTMLElement | null;
    return h1 ? Number.parseFloat(getComputedStyle(h1).fontSize) : null;
  });
  expect(heading).toBe(24);

  // CR-10 — depth orders, it does not decorate. Open a card and check that the
  // blocks inside the detail do not each carry their own painted surface.
  await page.getByTestId("agent-eval-card").first().click();
  const detail = page.getByTestId("agent-eval-detail");
  await expect(detail).toBeVisible();

  const ownSurfaces = await detail.evaluate((el) => {
    const container = getComputedStyle(el).backgroundColor;
    return Array.from(el.children[1]?.children ?? []).filter((child) => {
      const bg = getComputedStyle(child).backgroundColor;
      return bg !== "rgba(0, 0, 0, 0)" && bg !== container;
    }).length;
  });
  expect(ownSurfaces).toBe(0);
});
