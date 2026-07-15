import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import subagentsExtension from "./index.ts";
import { CHILD_EXCLUDED_TOOL_NAMES } from "./src/backends/pi.ts";

test("registers the complete Codex-style lifecycle tool surface", () => {
  const tools: string[] = [];
  const api = {
    on() {},
    registerTool(tool: { name: string }) {
      tools.push(tool.name);
    },
    registerMessageRenderer() {},
    registerCommand() {},
  } as unknown as ExtensionAPI;

  subagentsExtension(api);

  assert.deepEqual(tools, [
    "subagent_spawn",
    "subagent_send",
    "subagent_wait",
    "subagent_interrupt",
    "subagent_close",
    "subagent_cancel",
    "subagent_check",
    "subagent_list",
  ]);
});

test("Pi children cannot invoke any parent orchestration lifecycle tool", () => {
  const excluded = new Set<string>(CHILD_EXCLUDED_TOOL_NAMES);
  for (const name of [
    "subagent_spawn",
    "subagent_send",
    "subagent_wait",
    "subagent_interrupt",
    "subagent_close",
    "subagent_cancel",
    "subagent_check",
    "subagent_list",
  ]) {
    assert.ok(excluded.has(name));
  }
});
