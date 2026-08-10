import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import subagentsExtension, {
  assertAnthropicChildRouting,
  isAnthropicFamilyModel,
} from "./index.ts";
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

test("Anthropic children require an Anthropic-family primary model", () => {
  assert.equal(
    isAnthropicFamilyModel({ provider: "opencode", id: "claude-fable-5" }),
    true,
  );
  assert.equal(
    isAnthropicFamilyModel({ provider: "anthropic", id: "custom-model" }),
    true,
  );
  assert.equal(
    isAnthropicFamilyModel({ provider: "openai-codex", id: "gpt-5.6-sol" }),
    false,
  );

  assert.doesNotThrow(() =>
    assertAnthropicChildRouting({
      parentModel: { provider: "anthropic", id: "claude-opus-5" },
      harness: "claude",
      childModel: "claude-sonnet-5",
    }),
  );
  assert.doesNotThrow(() =>
    assertAnthropicChildRouting({
      parentModel: { provider: "xai", id: "grok-4.5" },
      harness: "pi",
      childModel: "xai/grok-4.5",
    }),
  );
  assert.throws(
    () =>
      assertAnthropicChildRouting({
        parentModel: { provider: "openai-codex", id: "gpt-5.6-sol" },
        harness: "claude",
        childModel: "claude-opus-5",
      }),
    /Anthropic subagents require an Anthropic-family primary orchestration model/,
  );
  assert.throws(
    () =>
      assertAnthropicChildRouting({
        parentModel: { provider: "xai", id: "grok-4.5" },
        harness: "pi",
        childModel: "opencode\/claude-fable-5",
      }),
    /Anthropic subagents require an Anthropic-family primary orchestration model/,
  );
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
