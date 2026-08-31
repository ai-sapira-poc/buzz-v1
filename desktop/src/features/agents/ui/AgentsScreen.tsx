import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { usePersonasQuery } from "@/features/agents/hooks";
import { useSkillsLibraryPanel } from "@/features/agents/skills/skillsLibraryStore";
import { SkillsLibraryPanel } from "@/features/agents/skills/ui/SkillsLibraryPanel";
import { useOpenDmMutation } from "@/features/channels/hooks";
import {
  type AgentsViewMode,
  parseAgentsViewMode,
  serializeAgentsViewMode,
} from "@/features/agents/ui/agentsViewMode";
import {
  type ProfilePanelTab,
  type ProfilePanelView,
  UserProfilePanel,
} from "@/features/profile/ui/UserProfilePanel";
import {
  profilePanelTabFromSearch,
  profilePanelViewFromSearch,
} from "@/features/profile/ui/UserProfilePanelUtils";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { AgentPersona } from "@/shared/api/types";
import {
  type ProfilePanelOpenOptions,
  ProfilePanelProvider,
} from "@/shared/context/ProfilePanelContext";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
import { useThreadPanelWidth } from "@/shared/hooks/useThreadPanelWidth";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const AgentsView = React.lazy(async () => {
  const module = await import("@/features/agents/ui/AgentsView");
  return { default: module.AgentsView };
});

const EvalDashboardView = React.lazy(async () => {
  const module = await import(
    "@/features/agents/eval-dashboard/ui/EvalDashboardView"
  );
  return { default: module.EvalDashboardView };
});

type ProfilePanelTarget =
  | { kind: "pubkey"; pubkey: string }
  | { kind: "persona"; persona: AgentPersona };

const AGENTS_SCREEN_SEARCH_KEYS = [
  "agentsView",
  "profile",
  "profilePersona",
  "profileTab",
  "profileView",
] as const;

export function AgentsScreen() {
  const identityQuery = useIdentityQuery();
  const personasQuery = usePersonasQuery();
  const { applyPatch, values } = useHistorySearchState(
    AGENTS_SCREEN_SEARCH_KEYS,
  );
  const agentsViewMode = parseAgentsViewMode(values.agentsView);
  const profilePanelTab = profilePanelTabFromSearch(values.profileTab);
  const profilePanelView = profilePanelViewFromSearch(values.profileView);
  const profilePanelTarget = React.useMemo<ProfilePanelTarget | null>(() => {
    if (values.profile) {
      return { kind: "pubkey", pubkey: values.profile };
    }

    if (values.profilePersona) {
      const persona = personasQuery.data?.find(
        (candidate) => candidate.id === values.profilePersona,
      );
      if (persona) {
        return { kind: "persona", persona };
      }
    }

    return null;
  }, [personasQuery.data, values.profile, values.profilePersona]);
  const threadPanelWidth = useThreadPanelWidth();
  const skillsLibrary = useSkillsLibraryPanel();
  const openDmMutation = useOpenDmMutation();
  const { goChannel } = useAppNavigation();

  const handleOpenProfilePanel = React.useCallback(
    (pubkey: string, options?: ProfilePanelOpenOptions) => {
      applyPatch({
        profile: pubkey,
        profilePersona: null,
        profileTab: options?.tab === "info" ? null : (options?.tab ?? null),
        profileView: null,
      });
    },
    [applyPatch],
  );

  const handleOpenPersonaProfilePanel = React.useCallback(
    (persona: AgentPersona) => {
      applyPatch({
        profile: null,
        profilePersona: persona.id,
        profileTab: null,
        profileView: null,
      });
    },
    [applyPatch],
  );
  const handleCloseProfilePanel = React.useCallback(() => {
    applyPatch({
      profile: null,
      profilePersona: null,
      profileTab: null,
      profileView: null,
    });
  }, [applyPatch]);
  const handleProfilePanelViewChange = React.useCallback(
    (view: ProfilePanelView, options?: { replace?: boolean }) =>
      applyPatch({ profileView: view === "summary" ? null : view }, options),
    [applyPatch],
  );
  const handleProfilePanelTabChange = React.useCallback(
    (tab: ProfilePanelTab, options?: { replace?: boolean }) =>
      applyPatch({ profileTab: tab === "info" ? null : tab }, options),
    [applyPatch],
  );

  const handleOpenDm = React.useCallback(
    async (pubkeys: string[]) => {
      const dm = await openDmMutation.mutateAsync({ pubkeys });
      await goChannel(dm.id);
    },
    [goChannel, openDmMutation],
  );

  const handleAgentsViewModeChange = React.useCallback(
    (mode: AgentsViewMode) => {
      applyPatch({ agentsView: serializeAgentsViewMode(mode) ?? null });
    },
    [applyPatch],
  );

  return (
    <ProfilePanelProvider
      onOpenPersonaProfilePanel={handleOpenPersonaProfilePanel}
      onOpenProfilePanel={handleOpenProfilePanel}
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-center border-b px-4 py-2">
          <Tabs
            onValueChange={(value) =>
              handleAgentsViewModeChange(value as AgentsViewMode)
            }
            value={agentsViewMode}
          >
            <TabsList data-testid="agents-view-mode-tabs">
              <TabsTrigger
                data-testid="agents-view-mode-tab-agents"
                value="agents"
              >
                Agents
              </TabsTrigger>
              <TabsTrigger
                data-testid="agents-view-mode-tab-evals"
                value="evals"
              >
                Evals
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
          <React.Suspense fallback={<ViewLoadingFallback kind="agents" />}>
            {agentsViewMode === "evals" ? (
              <EvalDashboardView />
            ) : (
              <AgentsView />
            )}
          </React.Suspense>
          {skillsLibrary.open && !profilePanelTarget ? (
            <SkillsLibraryPanel
              canResetWidth={threadPanelWidth.canReset}
              onResetWidth={threadPanelWidth.onResetWidth}
              onResizeStart={threadPanelWidth.onResizeStart}
              widthPx={threadPanelWidth.widthPx}
            />
          ) : null}
          {profilePanelTarget ? (
            <UserProfilePanel
              canResetWidth={threadPanelWidth.canReset}
              currentPubkey={identityQuery.data?.pubkey}
              onClose={handleCloseProfilePanel}
              onOpenDm={handleOpenDm}
              onOpenProfile={handleOpenProfilePanel}
              onResetWidth={threadPanelWidth.onResetWidth}
              onResizeStart={threadPanelWidth.onResizeStart}
              onTabChange={handleProfilePanelTabChange}
              onViewChange={handleProfilePanelViewChange}
              persona={
                profilePanelTarget.kind === "persona"
                  ? profilePanelTarget.persona
                  : undefined
              }
              pubkey={
                profilePanelTarget.kind === "pubkey"
                  ? profilePanelTarget.pubkey
                  : undefined
              }
              tab={profilePanelTab}
              view={profilePanelView}
              widthPx={threadPanelWidth.widthPx}
            />
          ) : null}
        </div>
      </div>
    </ProfilePanelProvider>
  );
}
