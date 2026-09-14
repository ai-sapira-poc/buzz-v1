import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_MANAGEMENT_REQUEST,
  createInputFromRequest,
  requestTargetsEditablePersona,
  parseAgentManagementRequest,
  updateInputFromRequest,
} from "./agentManagement.ts";
import {
  behaviorForSubmit,
  draftFromBehavior,
} from "./ui/personaBehaviorDraft.ts";

const CHANNEL_ID = "7c07e659-3610-42f4-9a5e-1e9973c09da9";

function createPayload(overrides = {}) {
  return {
    type: AGENT_MANAGEMENT_REQUEST,
    action: "create",
    requestId: "request-1",
    request: {
      channelId: CHANNEL_ID,
      displayName: "Research helper",
      systemPrompt: "Find reliable sources and summarize them.",
    },
    ...overrides,
  };
}

test("parses the narrow no-secret create request", () => {
  assert.deepEqual(
    parseAgentManagementRequest(createPayload()),
    createPayload(),
  );
});

test("rejects an agent-management request with extra secret-shaped fields", () => {
  const payload = createPayload();
  payload.request.apiKey = "should-not-be-accepted";

  assert.equal(parseAgentManagementRequest(payload), null);
});

test("chat creation cannot choose runtime, provider, model, or access", () => {
  for (const [field, value] of [
    ["runtime", "claude"],
    ["provider", "anthropic"],
    ["model", "claude-opus"],
    ["respondTo", "anyone"],
  ]) {
    const payload = createPayload();
    payload.request[field] = value;
    assert.equal(parseAgentManagementRequest(payload), null);
  }
});

test("chat creation leaves advanced behavior unset so the form stays collapsed", () => {
  const parsed = parseAgentManagementRequest(createPayload());
  assert.ok(parsed && parsed.action === "create");

  assert.deepEqual(createInputFromRequest(parsed), {
    displayName: "Research helper",
    systemPrompt: "Find reliable sources and summarize them.",
  });
});

test("requires the originating channel for profile updates", () => {
  const payload = {
    type: AGENT_MANAGEMENT_REQUEST,
    action: "update",
    requestId: "request-2",
    request: {
      agentName: "Review helper",
      systemPrompt: "Review changes concisely.",
    },
  };

  assert.equal(parseAgentManagementRequest(payload), null);
});

test("uses an agent's current name, never an internal profile ID", () => {
  const payload = {
    type: AGENT_MANAGEMENT_REQUEST,
    action: "update",
    requestId: "request-3",
    request: {
      channelId: CHANNEL_ID,
      agentName: "Review helper",
      systemPrompt: "Review changes concisely.",
    },
  };

  assert.deepEqual(parseAgentManagementRequest(payload), payload);
});

test("allows agents to update only personal, editable profiles", () => {
  assert.equal(
    requestTargetsEditablePersona({ isBuiltIn: false, sourceTeam: null }),
    true,
  );
  assert.equal(
    requestTargetsEditablePersona({ isBuiltIn: true, sourceTeam: null }),
    true,
  );
  assert.equal(
    requestTargetsEditablePersona({ isBuiltIn: false, sourceTeam: "team" }),
    false,
  );
});

test("agent-requested access edits preserve thread-scoped conversation context", () => {
  const request = {
    type: AGENT_MANAGEMENT_REQUEST,
    action: "update",
    requestId: "request-4",
    request: {
      channelId: CHANNEL_ID,
      agentName: "Review helper",
      respondTo: "anyone",
    },
  };
  const updated = updateInputFromRequest(request, {
    id: "review-helper",
    displayName: "Review helper",
    systemPrompt: "Review changes concisely.",
    behavior: {
      respondTo: "owner-only",
      respondToAllowlist: [],
      parallelism: 2,
      sessionPolicy: "thread",
    },
  });

  assert.equal(updated.behavior?.sessionPolicy, "thread");

  const seed = draftFromBehavior(updated.behavior);
  const edited = { ...seed, parallelism: "3" };
  assert.deepEqual(behaviorForSubmit(edited, seed, true), {
    respondTo: "anyone",
    respondToAllowlist: undefined,
    parallelism: 3,
    sessionPolicy: "thread",
  });
});

function updatePayload(request = {}) {
  return {
    type: AGENT_MANAGEMENT_REQUEST,
    action: "update",
    requestId: "request-2",
    request: { channelId: CHANNEL_ID, agentName: "Scout", ...request },
  };
}

test("carries a description through the update request", () => {
  // The card description was the one field the edit form showed and the
  // draft contract omitted, so fixing stale cards meant editing each one by
  // hand.
  const parsed = parseAgentManagementRequest(
    updatePayload({ description: "Analista de datos del equipo." }),
  );
  assert.equal(parsed.request.description, "Analista de datos del equipo.");
});

test("an empty description is a clear instruction, not an absent field", () => {
  const parsed = parseAgentManagementRequest(
    updatePayload({ description: "" }),
  );
  assert.equal(parsed.request.description, "");
});

test("a description alone is enough to be a change", () => {
  // `changes` must be non-empty or the whole request is discarded as a no-op.
  assert.notEqual(
    parseAgentManagementRequest(updatePayload({ description: "" })),
    null,
  );
});

test("a non-string description is rejected rather than coerced", () => {
  const parsed = parseAgentManagementRequest(
    updatePayload({ description: 42 }),
  );
  assert.equal(parsed, null);
});

test("clearing the description survives the overlay onto current input", () => {
  // `||` here would fall back to the existing text and make clearing
  // impossible — the exact case this whole change exists for.
  const current = {
    id: "persona-1",
    displayName: "Analista",
    description: "SIMULACIÓN Limonada. Especialista: analyst.",
    systemPrompt: "Map goal to signal to metric.",
  };
  const merged = updateInputFromRequest(
    parseAgentManagementRequest(updatePayload({ description: "" })),
    current,
  );
  assert.equal(merged.description, "");
  assert.equal(merged.systemPrompt, current.systemPrompt);
});

test("an unrequested description is left untouched", () => {
  const current = {
    id: "persona-1",
    displayName: "Analista",
    description: "texto actual",
    systemPrompt: "instrucciones",
  };
  const merged = updateInputFromRequest(
    parseAgentManagementRequest(updatePayload({ model: "cheap-combo" })),
    current,
  );
  assert.equal(merged.description, "texto actual");
});
