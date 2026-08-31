import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

const sourcePath = new URL("./agentsViewMode.ts", import.meta.url);
const source = await import("node:fs/promises").then((fs) =>
  fs.readFile(sourcePath, "utf8"),
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { parseAgentsViewMode, serializeAgentsViewMode } = await import(
  moduleUrl
);

test("parses the evals mode from its search param value", () => {
  assert.equal(parseAgentsViewMode("evals"), "evals");
});

test("defaults to agents mode for any other value", () => {
  for (const value of [undefined, null, "", "agents", "AGENTS", "Evals", 0, {}])
    assert.equal(parseAgentsViewMode(value), "agents");
});

test("serializes evals mode to its search param value", () => {
  assert.equal(serializeAgentsViewMode("evals"), "evals");
});

test("serializes agents mode to undefined so it drops out of the URL", () => {
  assert.equal(serializeAgentsViewMode("agents"), undefined);
});
