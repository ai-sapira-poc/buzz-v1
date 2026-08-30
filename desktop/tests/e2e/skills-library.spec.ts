import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

// The Skills library and the agent profile's read-only Skills and Evals
// sections. See docs/spec-agent-profile.md.
//
// The import flow is the one worth testing hardest, because both of its
// failure modes are silent *after* the write and cheap to catch before one:
//
//  - a name collision removes a skill from every agent's prompt, since the
//    first directory to claim a name wins (hints.rs:136);
//  - a missing description is the only thing the model reads when deciding
//    (L4), and by §1.1 that line lands in every agent's prompt.
//
// So the fixture below carries one of each, plus one clean skill, and the spec
// asserts that the preview refuses to write the first two untouched.

const IMPORT_DIR = "/Users/e2e/.claude/skills";

const SEEDED_SKILL = {
  name: "resumir-hilos",
  description:
    "Resumir un hilo largo en decisiones y pendientes. Usar cuando pidan el resumen de una conversación. No usar para redactar mensajes nuevos.",
  body: "# Resumir hilos\n\nLee el hilo entero antes de escribir.\n",
};

const IMPORT_FIXTURE = [
  {
    // Collides with the seeded skill: must be renamed, never overwritten.
    name: "resumir-hilos",
    description:
      "Resumen de conversaciones. Usar cuando pidan un resumen de un hilo.",
    body: "# Resumir hilos (de origen)\n",
  },
  {
    // No description at all: blocked until one is typed.
    name: "redactar-notas",
    description: "",
    body: "# Redactar notas\n",
  },
  {
    // Clean: imports as-is.
    name: "traducir-actas",
    description:
      "Traducir actas de reunión entre castellano e inglés conservando la numeración. Usar cuando pidan traducir un acta o unas minutas. No usar para redactar el acta original.",
    body: "# Traducir actas\n\nNo renumeres los acuerdos.\n",
  },
];

const EVALS_FIXTURE = {
  dir: "/Users/e2e/.buzz/.agents/evals/ana-soporte",
  exists: true,
  cases: [
    {
      number: 1,
      title: "Resume un hilo largo sin inventar acuerdos",
      origin: "nacimiento",
      date: "2026-08-20",
      author: "guillermo",
      input: "Hilo de 40 mensajes sobre precios.",
      expected: "Marca la decisión como sin cerrar.",
      fileName: "caso-01.md",
      problems: [],
    },
    {
      number: 2,
      title: "No presenta como acuerdo lo que fue una propuesta",
      origin: "feedback",
      date: "2026-08-29",
      author: "guillermo",
      input: "El mismo hilo, pidiendo «dame los acuerdos».",
      expected: "Responde que no hubo acuerdos.",
      fileName: "caso-02.md",
      problems: [],
    },
  ],
  feedback: [
    {
      date: "2026-08-29",
      author: "guillermo",
      status: "corregido",
      body: "Devolvió la opción B como acordada. Nadie la confirmó.",
      linkedCase: "caso-02",
    },
  ],
  bulletin: {
    date: "2026-08-29",
    runner: "manual",
    score: "0.75",
    trend: "sube",
    rows: [
      { case: "caso-01", score: "1.00", note: "Correcto." },
      { case: "caso-02", score: "0.50", note: "Sin matiz." },
    ],
    problems: [],
  },
  discrepancies: [],
};

type SeedInput = Parameters<
  NonNullable<typeof window.__BUZZ_E2E_SEED_SKILLS__>
>[0];

/**
 * The mock skills store lives in the page, so seeding has to happen after the
 * bridge is installed and the app has loaded — not in an `addInitScript`.
 */
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

async function openSkillsLibrary(page: Page) {
  await page.getByTestId("open-agents-view").click();
  await expect(page.getByTestId("agents-page-content")).toBeVisible();
  await page.getByTestId("skills-library-button").click();
  await expect(page.getByTestId("skills-library-panel")).toBeVisible();
}

test("the library lists skills, searches them, and renders a SKILL.md", async ({
  page,
}) => {
  await installMockBridge(page);
  await gotoApp(page);
  await seedSkills(page, {
    skills: [
      SEEDED_SKILL,
      {
        name: "revisar-pr",
        description:
          "Revisar un pull request buscando fallos de corrección. Usar cuando pidan revisar un diff antes de fusionar.",
        body: "# Revisar PR\n",
      },
    ],
  });

  await openSkillsLibrary(page);

  const rows = page.getByTestId("skills-library-row");
  await expect(rows).toHaveCount(2);

  await page.getByTestId("skills-library-search").fill("revisar");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("revisar-pr");

  await page.getByTestId("skills-library-search").fill("");
  await rows.filter({ hasText: "resumir-hilos" }).click();

  const detail = page.getByTestId("skills-library-detail");
  await expect(detail).toBeVisible();
  // Who reaches this skill — the answer that surprises people.
  await expect(page.getByTestId("skills-library-visibility")).toContainText(
    "claude",
  );
  await expect(page.getByTestId("skills-library-body")).toContainText(
    "Lee el hilo entero",
  );
});

test("importing flags a collision and a missing description before writing", async ({
  page,
}) => {
  // One running agent and one stopped, so the restart notice has both halves
  // to report (L1): a live session's skill list is fixed at session creation.
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        name: "Ana Soporte",
        status: "running",
      },
      {
        pubkey: TEST_IDENTITIES.charlie.pubkey,
        name: "Beto Ventas",
        status: "stopped",
      },
    ],
  });
  await gotoApp(page);
  await seedSkills(page, {
    skills: [SEEDED_SKILL],
    importSources: { [IMPORT_DIR]: IMPORT_FIXTURE },
  });
  await page.evaluate((dir) => {
    window.__BUZZ_E2E_PICK_SKILL_DIR__ = dir;
  }, IMPORT_DIR);

  await openSkillsLibrary(page);
  await page.getByTestId("skills-library-import").click();
  await page.getByTestId("skills-import-pick").click();

  const candidates = page.getByTestId("skills-import-candidate");
  await expect(candidates).toHaveCount(3);

  // Selected by `data-skill`, not by text: a candidate's name lives in an
  // input's `value`, which `hasText` does not see.
  const candidateFor = (name: string) =>
    page.locator(
      `[data-testid="skills-import-candidate"][data-skill="${name}"]`,
    );
  const collision = candidateFor("resumir-hilos");
  const noDescription = candidateFor("redactar-notas");
  const clean = candidateFor("traducir-actas");

  // Both warnings are shown, and both block until the user acts.
  await expect(collision.getByTestId("skills-import-collision")).toBeVisible();
  await expect(
    noDescription.getByTestId("skills-import-no-description"),
  ).toBeVisible();
  await expect(collision).toHaveAttribute("data-ready", "false");
  await expect(noDescription).toHaveAttribute("data-ready", "false");
  await expect(clean).toHaveAttribute("data-ready", "true");

  // Only the clean one can go through as-is.
  await expect(page.getByTestId("skills-import-confirm")).toContainText(
    "Import 1 skill",
  );

  // Resolve both: rename the collision, describe the undescribed one.
  await collision
    .getByTestId("skills-import-name")
    .fill("resumir-hilos-claude");
  await noDescription
    .getByTestId("skills-import-description")
    .fill(
      "Redactar notas de una reunión a partir de la transcripción. Usar cuando pidan pasar a limpio unas notas. No usar para traducirlas.",
    );

  await expect(collision).toHaveAttribute("data-ready", "true");
  await expect(noDescription).toHaveAttribute("data-ready", "true");

  // The restart notice is part of the write, not an afterthought (L1): a
  // running agent will not see the skill until it restarts.
  await expect(page.getByTestId("skills-restart-notice")).toBeVisible();
  await expect(page.getByTestId("skills-restart-needed")).toHaveText(
    "Ana Soporte",
  );
  await expect(page.getByTestId("skills-restart-will-see")).toContainText(
    "Beto Ventas",
  );

  await page.getByTestId("skills-import-confirm").click();

  const summary = page.getByTestId("skills-import-summary");
  await expect(summary).toBeVisible();
  await expect(page.getByTestId("skills-import-outcome")).toHaveCount(3);
  await expect(summary).not.toContainText("not committed");

  // One commit per skill, never a batch commit.
  const commits = await page.evaluate(
    () => window.__BUZZ_E2E_SKILL_COMMITS__?.() ?? [],
  );
  const imported = commits.filter((commit) =>
    commit.subject.startsWith("importa "),
  );
  expect(imported).toHaveLength(3);
  expect(imported.map((commit) => commit.subject).join("\n")).toContain(
    "importa resumir-hilos-claude: importada de",
  );

  // And the renamed skill landed under its new name, with the original intact.
  await page.getByTestId("skills-import-done").click();
  const rows = page.getByTestId("skills-library-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: "resumir-hilos-claude" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "traducir-actas" })).toHaveCount(1);
});

test("a skill created from the form appears in the library", async ({
  page,
}) => {
  await installMockBridge(page);
  await gotoApp(page);
  await seedSkills(page, { skills: [] });

  await openSkillsLibrary(page);
  await page.getByTestId("skills-library-new").click();

  const form = page.getByTestId("skills-create-form");
  await expect(form).toBeVisible();

  // The name rule is enforced in the form, not only in Rust.
  await page.getByTestId("skills-create-name").fill("No Valida");
  await expect(page.getByTestId("skills-create-name-error")).toBeVisible();
  await expect(page.getByTestId("skills-create-submit")).toBeDisabled();

  await page.getByTestId("skills-create-name").fill("traducir-actas");
  await page
    .getByTestId("skills-create-description")
    .fill(
      "Traducir actas de reunión entre castellano e inglés. Usar cuando pidan traducir un acta. No usar para redactarla.",
    );
  await page
    .getByTestId("skills-create-body")
    .fill("# Traducir actas\n\nNo renumeres los acuerdos.\n");

  await page.getByTestId("skills-create-submit").click();
  await expect(page.getByTestId("skills-create-done")).toBeVisible();

  await page.getByTestId("skills-create-back").click();
  const rows = page.getByTestId("skills-library-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("traducir-actas");

  const commits = await page.evaluate(
    () => window.__BUZZ_E2E_SKILL_COMMITS__?.() ?? [],
  );
  expect(commits[0]?.subject).toBe(
    "crea traducir-actas: creada desde la Library",
  );
});

test("the agent profile renders its Skills and Evals sections", async ({
  page,
}) => {
  const personaId = "custom:ana-soporte";
  await installMockBridge(page, {
    personas: [
      {
        id: personaId,
        displayName: "Ana Soporte",
        systemPrompt: "Atiendes soporte.",
      },
    ],
    managedAgents: [
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        name: "Ana Soporte",
        personaId,
        status: "stopped",
      },
    ],
  });
  await gotoApp(page);
  await seedSkills(page, {
    skills: [SEEDED_SKILL],
    evals: { "ana-soporte": EVALS_FIXTURE },
  });

  await page.getByTestId("open-agents-view").click();
  await expect(page.getByTestId("agents-page-content")).toBeVisible();

  await page.getByTestId(`persona-agent-row-${personaId}`).click();
  await page.getByTestId("user-profile-tab-runtime").click();

  await expect(page.getByTestId("agent-skills-section")).toBeVisible();
  await expect(page.getByTestId("agent-evals-section")).toBeVisible();

  // Skills: the row opens to show the rendered SKILL.md.
  const skillRow = page.getByTestId("agent-skill-row").first();
  await expect(skillRow).toContainText("resumir-hilos");
  await skillRow.click();
  await expect(page.getByTestId("agent-skill-body")).toContainText(
    "Lee el hilo entero",
  );

  // Evals: the bulletin, and the origin of each case.
  await expect(page.getByTestId("agent-evals-score")).toHaveText("0.75");
  await expect(page.getByTestId("agent-evals-trend")).toContainText("sube");
  const cases = page.getByTestId("agent-eval-case");
  await expect(cases).toHaveCount(2);
  await expect(cases.nth(0).getByTestId("agent-eval-origin")).toHaveText(
    "at birth",
  );
  await expect(cases.nth(1).getByTestId("agent-eval-origin")).toHaveText(
    "from feedback",
  );

  // The feedback log, with the case it produced.
  await expect(page.getByTestId("agent-evals-feedback")).toContainText(
    "→ caso-02",
  );

  // Read-only: no write affordance anywhere in either section.
  await expect(
    page.getByTestId("agent-skills-section").getByRole("button", {
      name: /new|create|import|edit|delete/i,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("agent-evals-section").getByRole("button", {
      name: /new|create|import|edit|delete/i,
    }),
  ).toHaveCount(0);
});
