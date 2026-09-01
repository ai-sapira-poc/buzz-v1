/**
 * Wire types for the skills library and the eval contract.
 *
 * These mirror the `serde(rename_all = "camelCase")` shapes in
 * `desktop/src-tauri/src/skills_library/`. The contract they describe is
 * `docs/spec-agent-profile.md`.
 */

/** Why a skill is invisible or unfindable. Reported, never hidden. */
export type SkillProblem = {
  code: string;
  message: string;
};

/**
 * How usable a skill's activation description is.
 *
 * The description is the only field the model reads when deciding whether to
 * use a skill, and by §1.1 that line reaches every agent on the machine — so a
 * vague one does not merely fail to fire, it fires on other agents' turns.
 */
export type DescriptionVerdict = "usable" | "generic" | "missing";

export type ParsedSkill = {
  name: string;
  dirName: string;
  description: string;
  descriptionVerdict: DescriptionVerdict;
  version: string | null;
  path: string;
  dir: string;
  supportingFiles: string[];
  problems: SkillProblem[];
  /** False when the runtime would discard this skill outright. */
  discoverable: boolean;
};

/** Where a discovered skill came from. */
export type SkillScope = "nest" | "machineGlobal" | "runtimeOwned";

export type DiscoveredSkill = ParsedSkill & {
  scope: SkillScope;
  sourceDir: string;
  /** True when an earlier directory claimed the name and the runtime drops this copy. */
  shadowed: boolean;
  shadowedBy: string | null;
};

export type ScannedDir = {
  path: string;
  label: string;
  scope: SkillScope;
  exists: boolean;
};

export type RuntimeSkillView = {
  runtimeId: string;
  cwd: string;
  skills: DiscoveredSkill[];
  scanned: ScannedDir[];
};

export type LibrarySkill = ParsedSkill & {
  visibleTo: string[];
  linksComplete: boolean;
  missingLinks: string[];
};

export type SkillDocument = {
  path: string;
  frontmatter: string | null;
  body: string;
};

// ── Import ───────────────────────────────────────────────────────────────────

export type ImportCandidate = ParsedSkill & {
  source: string;
  collidesWithExisting: boolean;
  collidesWithinBatch: boolean;
  nameError: string | null;
  suggestedName: string | null;
  descriptionHint: string | null;
  /** True when the user must resolve something before this one can be imported. */
  blocked: boolean;
};

export type ImportPreview = {
  source: string;
  singleSkill: boolean;
  candidates: ImportCandidate[];
  truncated: string | null;
};

export type ConfirmedImport = {
  source: string;
  name: string;
  description: string;
};

export type WriteOutcome = {
  name: string;
  dir: string;
  links: string[];
  commit: string | null;
  warnings: string[];
};

export type ImportResult = {
  outcomes: WriteOutcome[];
  failures: string[];
};

export type SkillCommit = {
  hash: string;
  subject: string;
};

// ── Evals ────────────────────────────────────────────────────────────────────

export type EvalCase = {
  number: number;
  title: string;
  /** `nacimiento` | `feedback` */
  origin: string;
  date: string;
  author: string;
  input: string;
  expected: string;
  fileName: string;
  problems: SkillProblem[];
};

export type FeedbackEntry = {
  date: string;
  author: string;
  /** `abierto` | `corregido` | `descartado` */
  status: string;
  body: string;
  linkedCase: string | null;
};

export type BulletinRow = {
  case: string;
  score: string;
  note: string;
};

export type Bulletin = {
  date: string;
  runner: string;
  score: string;
  /** `sube` | `baja` | `estable` | `primera` */
  trend: string;
  rows: BulletinRow[];
  problems: SkillProblem[];
};

export type AgentEvals = {
  dir: string;
  exists: boolean;
  cases: EvalCase[];
  feedback: FeedbackEntry[];
  bulletin: Bulletin | null;
  discrepancies: string[];
};

/**
 * One agent's evals, with the folder name it was listed under.
 *
 * Mirrors `AgentEvalSummary` in `skills_library::contract` — Rust flattens
 * `evals: AgentEvals` into the same JSON object via `#[serde(flatten)]`, so
 * on the wire this is `AgentEvals` plus `dirName`, not a nested `evals` key.
 */
export type AgentEvalSummary = AgentEvals & {
  /** The folder name as it sits on disk under `evals_dir()` (§3.1). */
  dirName: string;
};

/**
 * The whole evals listing: the root that was read, plus one entry per agent.
 *
 * Mirrors `AgentEvalListing` in `skills_library::contract`. `root` travels even
 * when `agents` is empty (R3): a missing root and a root with no agents both
 * list zero agents, and the path is the only thing that tells them apart —
 * `AgentEvals.dir` is per agent, so an empty listing carries no `dir` at all.
 */
export type AgentEvalListing = {
  /** The directory that was read, whether or not it exists. */
  root: string;
  agents: AgentEvalSummary[];
};
