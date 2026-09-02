import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import subagentsExtension from "./index.ts";
import {
  CHILD_EXCLUDED_TOOL_NAMES,
  piSessionSendMode,
} from "./src/backends/pi.ts";

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

test("subagent_spawn exposes the explicit persistent-child choice", () => {
  let spawnTool:
    { parameters?: { properties?: Record<string, unknown> } } | undefined;
  const api = {
    on() {},
    registerTool(tool: {
      name: string;
      parameters?: { properties?: Record<string, unknown> };
    }) {
      if (tool.name === "subagent_spawn") spawnTool = tool;
    },
    registerMessageRenderer() {},
    registerCommand() {},
  } as unknown as ExtensionAPI;

  subagentsExtension(api);

  assert.ok(spawnTool?.parameters?.properties?.persistent);
});

test("disposable Pi children reject the native-idle terminal-event race", () => {
  assert.equal(piSessionSendMode(false, true), "steer");
  assert.equal(piSessionSendMode(false, false), "released");
  assert.equal(piSessionSendMode(true, false), "start");
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
