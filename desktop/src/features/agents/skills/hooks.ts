/**
 * React Query hooks for the skills library and the eval contract.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ManagedAgent } from "@/shared/api/types";
import {
  confirmSkillImport,
  createLibrarySkill,
  fetchRuntimeSkills,
  listLibrarySkills,
  listSkillCommits,
  previewSkillImport,
  readAgentEvals,
  readSkillDocument,
  updateLibrarySkill,
} from "./api";
import type { ConfirmedImport } from "./types";

export const librarySkillsKey = ["skills-library", "inventory"] as const;
export const skillCommitsKey = ["skills-library", "commits"] as const;

export const runtimeSkillsKey = (runtimeId: string) =>
  ["skills-library", "runtime", runtimeId] as const;

export const skillDocumentKey = (dir: string) =>
  ["skills-library", "document", dir] as const;

export const agentEvalsKey = (agentName: string) =>
  ["agent-evals", agentName] as const;

export function useLibrarySkillsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    enabled: options?.enabled ?? true,
    queryFn: listLibrarySkills,
    queryKey: librarySkillsKey,
    staleTime: 15_000,
  });
}

export function useSkillCommitsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    enabled: options?.enabled ?? true,
    queryFn: () => listSkillCommits(20),
    queryKey: skillCommitsKey,
    staleTime: 15_000,
  });
}

export function useRuntimeSkillsQuery(
  runtimeId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    enabled: Boolean(runtimeId) && (options?.enabled ?? true),
    queryFn: () => fetchRuntimeSkills(runtimeId as string),
    queryKey: runtimeSkillsKey(runtimeId ?? ""),
    staleTime: 15_000,
  });
}

/**
 * The rendered `SKILL.md` of one skill, fetched when the reader opens it.
 *
 * Deliberately lazy: the body never reaches an agent's prompt until it calls
 * `load_skill`, and it does not need to reach this panel until someone asks
 * for it either.
 */
export function useSkillDocumentQuery(
  dir: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    enabled: Boolean(dir) && (options?.enabled ?? true),
    queryFn: () => readSkillDocument(dir as string),
    queryKey: skillDocumentKey(dir ?? ""),
    staleTime: 60_000,
  });
}

export function useAgentEvalsQuery(
  agentName: string | null | undefined,
  pubkey?: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    enabled: Boolean(agentName) && (options?.enabled ?? true),
    queryFn: () => readAgentEvals(agentName as string, pubkey),
    queryKey: agentEvalsKey(agentName ?? ""),
    staleTime: 15_000,
  });
}

/** Invalidate everything a write can change. */
function useInvalidateLibrary() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: librarySkillsKey });
    void queryClient.invalidateQueries({ queryKey: skillCommitsKey });
    void queryClient.invalidateQueries({
      queryKey: ["skills-library", "runtime"],
    });
  };
}

export function usePreviewSkillImportMutation() {
  return useMutation({
    mutationFn: (source: string) => previewSkillImport(source),
  });
}

export function useConfirmSkillImportMutation() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: (input: { source: string; items: ConfirmedImport[] }) =>
      confirmSkillImport(input.source, input.items),
    onSuccess: invalidate,
  });
}

export function useCreateSkillMutation() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: createLibrarySkill,
    onSuccess: invalidate,
  });
}

export function useUpdateSkillMutation() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: updateLibrarySkill,
    onSuccess: invalidate,
  });
}

/**
 * Which agents pick a new skill up on their own, and which need a restart.
 *
 * L1, verified in `docs/plan-agent-creator.md` §4: `build_hints_section` runs
 * once, inside `session_new`. The skills of a live session are fixed when that
 * session is created, so writing a skill now changes nothing for an agent that
 * is already running. Saying so is not a nicety — without it the user writes a
 * skill, watches a running agent ignore it, and concludes the feature is broken.
 */
export function splitAgentsByRestartNeed(agents: ManagedAgent[] | undefined): {
  willSee: string[];
  needsRestart: string[];
} {
  const willSee: string[] = [];
  const needsRestart: string[] = [];
  for (const agent of agents ?? []) {
    if (agent.status === "running") {
      needsRestart.push(agent.name);
    } else {
      willSee.push(agent.name);
    }
  }
  willSee.sort((a, b) => a.localeCompare(b));
  needsRestart.sort((a, b) => a.localeCompare(b));
  return { willSee, needsRestart };
}
