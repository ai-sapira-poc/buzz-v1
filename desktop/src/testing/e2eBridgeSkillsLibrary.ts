/**
 * In-memory skills library for the e2e bridge.
 *
 * Extracted as its own module, like `e2eBridgeCustomHarnesses.ts`, so the
 * handler logic can be unit-tested without the full bridge context.
 *
 * This is a *behavioural* mock, not a stub: it reproduces the parts of
 * `docs/spec-agent-profile.md` a spec needs to exercise — name collisions, the
 * description verdict, the per-skill commit log — so an import flow test fails
 * for the same reasons the real one would. It does not touch a filesystem.
 */

export type MockSkillProblem = { code: string; message: string };

export type MockSkill = {
  name: string;
  dirName: string;
  description: string;
  descriptionVerdict: "usable" | "generic" | "missing";
  version: string | null;
  path: string;
  dir: string;
  body: string;
  supportingFiles: string[];
  problems: MockSkillProblem[];
  discoverable: boolean;
  visibleTo: string[];
  linksComplete: boolean;
  missingLinks: string[];
};

export type MockImportCandidate = MockSkill & {
  source: string;
  collidesWithExisting: boolean;
  collidesWithinBatch: boolean;
  nameError: string | null;
  suggestedName: string | null;
  descriptionHint: string | null;
  blocked: boolean;
};

export type MockCommit = { hash: string; subject: string };

const NEST = "/Users/e2e/.buzz";
const CANONICAL = `${NEST}/.agents/skills`;
const RUNTIMES = ["buzz-agent", "codex", "claude", "goose"];

/** Canonical skills, keyed by name. */
export const mockLibrarySkills = new Map<string, MockSkill>();
/** Commit log of the skills repository, newest first. */
export const mockSkillCommits: MockCommit[] = [];
/** Import sources a spec has seeded, keyed by the directory path. */
export const mockImportSources = new Map<
  string,
  {
    name: string;
    description: string;
    body: string;
    supportingFiles?: string[];
  }[]
>();
/** Per-agent evals, keyed by the agent's slug. */
export const mockAgentEvals = new Map<string, unknown>();

let commitCounter = 0;

export function resetMockSkillsLibrary(): void {
  mockLibrarySkills.clear();
  mockSkillCommits.length = 0;
  mockImportSources.clear();
  mockAgentEvals.clear();
  commitCounter = 0;
}

const TRIGGER_MARKERS = [
  "usar cuando",
  "use when",
  "usar para",
  "cuando ",
  "when ",
  "trigger",
  "úsala",
  "usala",
];

/** Mirrors `names::judge_description`. */
export function judgeMockDescription(
  description: string,
): "usable" | "generic" | "missing" {
  const trimmed = description.trim();
  if (!trimmed) return "missing";
  if (trimmed.length < 40) return "generic";
  const lowered = trimmed.toLowerCase();
  return TRIGGER_MARKERS.some((marker) => lowered.includes(marker))
    ? "usable"
    : "generic";
}

/** Mirrors `names::validate_skill_name`. */
export function validateMockSkillName(name: string): string | null {
  if (!name) return "The name is required.";
  if (name.length > 64) return "The name must be at most 64 characters.";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    return "Use kebab-case: lowercase letters, digits and single hyphens (e.g. resumir-hilos).";
  }
  return null;
}

function describeProblems(
  name: string,
  description: string,
): { problems: MockSkillProblem[]; discoverable: boolean } {
  const problems: MockSkillProblem[] = [];
  const verdict = judgeMockDescription(description);
  if (verdict === "missing") {
    problems.push({
      code: "missingDescription",
      message:
        "No description: the model only reads the description when deciding whether to use a skill.",
    });
  } else if (verdict === "generic") {
    problems.push({
      code: "genericDescription",
      message:
        "The description does not name a trigger, so it can hijack turns meant for other agents.",
    });
  }
  return { problems, discoverable: Boolean(name) };
}

export function makeMockSkill(input: {
  name: string;
  description: string;
  body?: string;
  supportingFiles?: string[];
  dir?: string;
}): MockSkill {
  const dir = input.dir ?? `${CANONICAL}/${input.name}`;
  const { problems, discoverable } = describeProblems(
    input.name,
    input.description,
  );
  return {
    name: input.name,
    dirName: input.name,
    description: input.description,
    descriptionVerdict: judgeMockDescription(input.description),
    version: "1",
    path: `${dir}/SKILL.md`,
    dir,
    body: input.body ?? `# ${input.name}\n\nCuerpo de prueba.\n`,
    supportingFiles: input.supportingFiles ?? [],
    problems,
    discoverable,
    visibleTo: [...RUNTIMES],
    linksComplete: true,
    missingLinks: [],
  };
}

/** Seed the canonical library. Used by specs before mounting the app. */
export function seedMockLibrarySkill(input: {
  name: string;
  description: string;
  body?: string;
  supportingFiles?: string[];
}): void {
  const skill = makeMockSkill(input);
  mockLibrarySkills.set(skill.name, skill);
}

export function handleListLibrarySkills(): MockSkill[] {
  return [...mockLibrarySkills.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function handleListSkillCommits(limit?: number): MockCommit[] {
  return mockSkillCommits.slice(0, limit ?? 50);
}

/** Mirrors `import::plan_import`. */
export function handlePreviewSkillImport(source: string): {
  source: string;
  singleSkill: boolean;
  candidates: MockImportCandidate[];
  truncated: string | null;
} {
  const entries = mockImportSources.get(source) ?? [];
  const seen = new Set<string>();
  const candidates = entries.map((entry) => {
    const nameError = validateMockSkillName(entry.name);
    const collidesWithExisting = mockLibrarySkills.has(entry.name);
    const collidesWithinBatch = seen.has(entry.name);
    seen.add(entry.name);
    const verdict = judgeMockDescription(entry.description);
    const needsRename =
      nameError !== null || collidesWithExisting || collidesWithinBatch;
    const base = makeMockSkill({
      name: entry.name,
      description: entry.description,
      body: entry.body,
      supportingFiles: entry.supportingFiles,
      dir: `${source}/${entry.name}`,
    });
    return {
      ...base,
      source: `${source}/${entry.name}`,
      collidesWithExisting,
      collidesWithinBatch,
      nameError,
      suggestedName: needsRename ? `${entry.name}-2` : null,
      descriptionHint:
        verdict === "missing"
          ? "Without a description the model never sees this skill — it only reads the description when deciding. Add what it does, when to use it, and when not to."
          : verdict === "generic"
            ? "This description does not say when to use the skill. Every agent on this machine sees it, so a vague one hijacks turns that belong elsewhere. Say what it does, when to use it, and when not to."
            : null,
      blocked: needsRename || verdict === "missing",
    } satisfies MockImportCandidate;
  });

  return {
    source,
    singleSkill: false,
    candidates,
    truncated: null,
  };
}

function recordCommit(subject: string): string {
  commitCounter += 1;
  const hash = `c0mm1t${commitCounter}`;
  // Newest first, matching `git log`.
  mockSkillCommits.unshift({ hash, subject });
  return hash;
}

/** Mirrors `confirm_skill_import`: one commit per skill, never a batch. */
export function handleConfirmSkillImport(payload: {
  source: string;
  items: { source: string; name: string; description: string }[];
}): {
  outcomes: {
    name: string;
    dir: string;
    links: string[];
    commit: string | null;
    warnings: string[];
  }[];
  failures: string[];
} {
  const entries = mockImportSources.get(payload.source) ?? [];
  const outcomes = [];
  const failures: string[] = [];

  for (const item of payload.items) {
    const nameError = validateMockSkillName(item.name);
    if (nameError) {
      failures.push(`${item.name}: ${nameError}`);
      continue;
    }
    if (mockLibrarySkills.has(item.name)) {
      failures.push(
        `${item.name}: already exists. Rename the skill instead of overwriting it.`,
      );
      continue;
    }
    if (judgeMockDescription(item.description) === "missing") {
      failures.push(
        `${item.name}: a skill with no description never reaches the model's decision. Add one.`,
      );
      continue;
    }

    const origin = item.source.split("/").slice(0, -1).join("/");
    const seeded = entries.find((entry) =>
      item.source.endsWith(`/${entry.name}`),
    );
    const skill = makeMockSkill({
      name: item.name,
      description: item.description,
      body: seeded?.body,
      supportingFiles: seeded?.supportingFiles,
    });
    mockLibrarySkills.set(skill.name, skill);
    const commit = recordCommit(`importa ${item.name}: importada de ${origin}`);
    outcomes.push({
      name: item.name,
      dir: skill.dir,
      links: [
        `${NEST}/.claude/skills/${item.name}`,
        `${NEST}/.goose/skills/${item.name}`,
      ],
      commit,
      warnings: [],
    });
  }

  return { outcomes, failures };
}

export function handleCreateLibrarySkill(payload: {
  name: string;
  description: string;
  body: string;
}): {
  name: string;
  dir: string;
  links: string[];
  commit: string | null;
  warnings: string[];
} {
  const nameError = validateMockSkillName(payload.name);
  if (nameError) throw new Error(nameError);
  if (mockLibrarySkills.has(payload.name)) {
    throw new Error(
      `A skill named \`${payload.name}\` already exists. Pick another name — overwriting one silently removes it from every agent's prompt.`,
    );
  }
  if (judgeMockDescription(payload.description) === "missing") {
    throw new Error(
      "The activation description is required: it is the only thing the model reads when deciding whether to use a skill.",
    );
  }
  const skill = makeMockSkill({
    name: payload.name,
    description: payload.description,
    body: payload.body,
  });
  mockLibrarySkills.set(skill.name, skill);
  const commit = recordCommit(`crea ${payload.name}: creada desde la Library`);
  return {
    name: payload.name,
    dir: skill.dir,
    links: [
      `${NEST}/.claude/skills/${payload.name}`,
      `${NEST}/.goose/skills/${payload.name}`,
    ],
    commit,
    warnings: [],
  };
}

export function handleUpdateLibrarySkill(payload: {
  name: string;
  description: string;
  body: string;
}): {
  name: string;
  dir: string;
  links: string[];
  commit: string | null;
  warnings: string[];
} {
  const existing = mockLibrarySkills.get(payload.name);
  if (!existing) throw new Error(`No skill named \`${payload.name}\`.`);
  const next = makeMockSkill({
    name: payload.name,
    description: payload.description,
    body: payload.body,
    supportingFiles: existing.supportingFiles,
  });
  mockLibrarySkills.set(payload.name, next);
  const commit = recordCommit(
    `edita ${payload.name}: actualizada desde la Library`,
  );
  return {
    name: payload.name,
    dir: next.dir,
    links: [],
    commit,
    warnings: [],
  };
}

export function handleReadSkillDocument(dir: string): {
  path: string;
  frontmatter: string | null;
  body: string;
} {
  const skill = [...mockLibrarySkills.values()].find((s) => s.dir === dir);
  if (!skill) throw new Error(`${dir} could not be resolved`);
  return {
    path: skill.path,
    frontmatter: `name: ${skill.name}\ndescription: ${skill.description}`,
    body: skill.body,
  };
}

/** What one runtime would discover, with shadowing marked. */
export function handleAgentRuntimeSkills(runtimeId: string): {
  runtimeId: string;
  cwd: string;
  skills: (MockSkill & {
    scope: string;
    sourceDir: string;
    shadowed: boolean;
    shadowedBy: string | null;
  })[];
  scanned: { path: string; label: string; scope: string; exists: boolean }[];
} {
  const skills = handleListLibrarySkills().map((skill) => ({
    ...skill,
    scope: "nest",
    sourceDir: ".agents/skills",
    shadowed: false,
    shadowedBy: null,
  }));
  return {
    runtimeId,
    cwd: NEST,
    skills,
    scanned: [
      { path: CANONICAL, label: ".agents/skills", scope: "nest", exists: true },
      {
        path: `${NEST}/.goose/skills`,
        label: ".goose/skills",
        scope: "nest",
        exists: true,
      },
      {
        path: `${NEST}/.claude/skills`,
        label: ".claude/skills",
        scope: "nest",
        exists: true,
      },
      {
        path: "/Users/e2e/.agents/skills",
        label: "~/.agents/skills",
        scope: "machineGlobal",
        exists: false,
      },
    ],
  };
}

/** Default evals payload: the shape `read_agent_eval_contract` returns. */
export function emptyMockEvals(slug: string) {
  return {
    dir: `${NEST}/.agents/evals/${slug}`,
    exists: false,
    cases: [],
    feedback: [],
    bulletin: null,
    discrepancies: [],
  };
}

export function handleReadAgentEvals(agentName: string) {
  const slug = agentName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return mockAgentEvals.get(slug) ?? emptyMockEvals(slug);
}

/**
 * Every seeded agent's evals, one entry per folder (I5's dependency on I1's
 * `list_agent_eval_summaries` — `EvalDashboardView` reads this, not
 * `read_agent_eval_contract`). "La carpeta manda": only folders seeded via
 * `__BUZZ_E2E_SEED_SKILLS__({ evals })` are listed, same as the real command
 * only lists what exists under `evals_dir()`.
 */
export function handleListAgentEvalSummaries() {
  return [...mockAgentEvals.entries()].map(([dirName, evals]) => ({
    ...(evals as object),
    dirName,
  }));
}
