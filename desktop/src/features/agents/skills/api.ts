/**
 * Tauri bridge for the skills library and the eval contract.
 *
 * Thin by design: every guard that matters — path allow-listing, name
 * validation, collision refusal — lives in Rust, because it has to hold for any
 * caller, not just this UI.
 */

import { invokeTauri } from "@/shared/api/tauri";
import type {
  AgentEvals,
  AgentEvalListing,
  ConfirmedImport,
  ImportPreview,
  ImportResult,
  LibrarySkill,
  RuntimeSkillView,
  SkillCommit,
  SkillDocument,
  WriteOutcome,
} from "./types";

/** Every skill in the canonical directory, with the runtimes that see it. */
export function listLibrarySkills(): Promise<LibrarySkill[]> {
  return invokeTauri<LibrarySkill[]>("list_library_skills");
}

/** What one runtime would discover, in resolution order, shadowing marked. */
export function fetchRuntimeSkills(
  runtimeId: string,
): Promise<RuntimeSkillView> {
  return invokeTauri<RuntimeSkillView>("agent_runtime_skills", { runtimeId });
}

/** Read one `SKILL.md`, split into frontmatter and body. */
export function readSkillDocument(dir: string): Promise<SkillDocument> {
  return invokeTauri<SkillDocument>("read_skill_document", { dir });
}

export function readSkillSupportingFile(
  dir: string,
  relative: string,
): Promise<string> {
  return invokeTauri<string>("read_skill_supporting_file", { dir, relative });
}

/** One agent's evals. A missing directory comes back as an empty result. */
export function readAgentEvals(
  agentName: string,
  pubkey?: string,
): Promise<AgentEvals> {
  return invokeTauri<AgentEvals>("read_agent_eval_contract", {
    agentName,
    pubkey: pubkey ?? null,
  });
}

/**
 * Every agent's evals, one entry per folder under `evals_dir()` (R1).
 *
 * "La carpeta manda": an agent registered in `managed-agents.json` with no
 * folder does not appear, and a folder with no matching registration still
 * does. Read-only, same as {@link readAgentEvals}.
 */
export function listAgentEvalSummaries(): Promise<AgentEvalListing> {
  return invokeTauri<AgentEvalListing>("list_agent_eval_summaries");
}

/** Preview an import. Reads only; writes nothing. */
export function previewSkillImport(source: string): Promise<ImportPreview> {
  return invokeTauri<ImportPreview>("preview_skill_import", { source });
}

/** Write the confirmed skills: canonical copy, symlinks, one commit each. */
export function confirmSkillImport(
  source: string,
  items: ConfirmedImport[],
): Promise<ImportResult> {
  return invokeTauri<ImportResult>("confirm_skill_import", { source, items });
}

export function createLibrarySkill(input: {
  name: string;
  description: string;
  body: string;
}): Promise<WriteOutcome> {
  return invokeTauri<WriteOutcome>("create_library_skill", input);
}

export function updateLibrarySkill(input: {
  name: string;
  description: string;
  body: string;
}): Promise<WriteOutcome> {
  return invokeTauri<WriteOutcome>("update_library_skill", input);
}

export function listSkillCommits(limit?: number): Promise<SkillCommit[]> {
  return invokeTauri<SkillCommit[]>("list_skill_commits", {
    limit: limit ?? null,
  });
}
