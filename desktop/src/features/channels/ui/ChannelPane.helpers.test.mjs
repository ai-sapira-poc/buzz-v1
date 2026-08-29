import assert from "node:assert/strict";
import test from "node:test";

import {
  getChannelIntroDescription,
  getChannelIntroKind,
  shouldPrioritizeIdleAuxiliary,
  shouldUseFocusIdleDrawer,
} from "./ChannelPane.helpers.ts";

function channel(overrides = {}) {
  return {
    ttlDeadline: null,
    ttlSeconds: null,
    visibility: "open",
    ...overrides,
  };
}

test("focus idle drawers yield to every higher-priority auxiliary surface", () => {
  const idleDrawer = {
    channelManagementOpen: false,
    hasAgentSession: false,
    hasIdleAuxiliaryPanel: true,
    hasIdlePanelCloseHandler: true,
    hasProfilePanel: false,
    hasThreadSurface: false,
    useSplitAuxiliaryPane: true,
  };

  assert.equal(shouldUseFocusIdleDrawer(idleDrawer), true);
  for (const surface of [
    "channelManagementOpen",
    "hasAgentSession",
    "hasProfilePanel",
    "hasThreadSurface",
  ]) {
    assert.equal(
      shouldUseFocusIdleDrawer({ ...idleDrawer, [surface]: true }),
      false,
      `idle drawer must yield when ${surface} is open`,
    );
  }
});

test("an explicit thread override keeps the idle panel in its own focus drawer", () => {
  assert.equal(
    shouldUseFocusIdleDrawer({
      channelManagementOpen: false,
      hasAgentSession: false,
      hasIdleAuxiliaryPanel: true,
      hasIdlePanelCloseHandler: true,
      hasProfilePanel: false,
      hasThreadSurface: true,
      overrideThread: true,
      useSplitAuxiliaryPane: false,
    }),
    true,
  );
});

test("channel intro shares description-over-purpose derivation with the header", () => {
  assert.equal(
    getChannelIntroDescription(
      channel({
        description: "Description paragraphs.\n\nKeep this structure.",
        purpose: "Legacy purpose",
        topic: "",
      }),
    ),
    "Description paragraphs.\n\nKeep this structure.",
  );
});

test("getChannelIntroKind names project homes ahead of regular streams", () => {
  assert.equal(getChannelIntroKind(channel(), true), "project channel");
  assert.equal(getChannelIntroKind(channel(), false), "regular channel");
});

test("getChannelIntroKind keeps private and ephemeral labels for other streams", () => {
  assert.equal(
    getChannelIntroKind(channel({ visibility: "private" })),
    "private channel",
  );
  assert.equal(
    getChannelIntroKind(channel({ ttlSeconds: 3600 })),
    "ephemeral channel",
  );
});

test("idle auxiliary priority does not depend on thread layout mode", () => {
  assert.equal(shouldPrioritizeIdleAuxiliary(true, true), true);
  assert.equal(shouldPrioritizeIdleAuxiliary(true, false), false);
  assert.equal(shouldPrioritizeIdleAuxiliary(false, true), false);
});

// --- preferDockedPane: the artifact preview panel opts out of the drawer ---

const DOCKED_BASE = {
  channelManagementOpen: false,
  hasAgentSession: false,
  hasIdleAuxiliaryPanel: true,
  hasIdlePanelCloseHandler: true,
  hasProfilePanel: false,
  hasThreadSurface: false,
  useSplitAuxiliaryPane: true,
};

test("shouldUseFocusIdleDrawer: an idle panel alone on a wide window is a drawer", () => {
  // The pre-existing default, and the reason the artifact panel shipped without
  // a resize handle: FocusThreadDrawer renders none.
  assert.equal(shouldUseFocusIdleDrawer(DOCKED_BASE), true);
});

test("shouldUseFocusIdleDrawer: preferDockedPane opts out of the drawer", () => {
  assert.equal(
    shouldUseFocusIdleDrawer({ ...DOCKED_BASE, preferDockedPane: true }),
    false,
  );
});

test("shouldUseFocusIdleDrawer: preferDockedPane wins even over an overridden thread", () => {
  assert.equal(
    shouldUseFocusIdleDrawer({
      ...DOCKED_BASE,
      hasThreadSurface: true,
      overrideThread: true,
      preferDockedPane: true,
    }),
    false,
  );
});

test("shouldUseFocusIdleDrawer: omitting preferDockedPane changes nothing for existing callers", () => {
  // The projects workspace sheet must keep its drawer presentation.
  assert.equal(shouldUseFocusIdleDrawer({ ...DOCKED_BASE }), true);
});
