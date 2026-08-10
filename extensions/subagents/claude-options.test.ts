import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_CLAUDE_MODELS,
  claudeReasoningOptions,
  claudeToolsForRole,
  resolveClaudeModel,
} from "./src/backends/claude.ts";

test("Claude models are pinned to the approved exact IDs", () => {
  assert.deepEqual(ALLOWED_CLAUDE_MODELS, [
    "claude-haiku-4-5",
    "claude-sonnet-5",
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-fable-5",
  ]);
  assert.equal(resolveClaudeModel(undefined), "claude-opus-5");
  assert.equal(resolveClaudeModel("claude-sonnet-5"), "claude-sonnet-5");
  assert.equal(resolveClaudeModel("claude-fable-5"), "claude-fable-5");
  assert.throws(() => resolveClaudeModel("sonnet"), /Unsupported Claude model/);
});

test("omitted Claude effort defaults to high adaptive thinking", () => {
  assert.deepEqual(claudeReasoningOptions("claude-opus-5", undefined), {
    thinking: { type: "adaptive" },
    effort: "high",
  });
});

test("Sonnet 5 low uses native adaptive effort", () => {
  assert.deepEqual(claudeReasoningOptions("claude-sonnet-5", "low"), {
    thinking: { type: "adaptive" },
    effort: "low",
  });
  assert.deepEqual(claudeReasoningOptions("claude-sonnet-5", "off"), {
    thinking: { type: "disabled" },
  });
});

test("Haiku uses fixed thinking only when explicitly enabled", () => {
  assert.deepEqual(claudeReasoningOptions("claude-haiku-4-5", "off"), {
    thinking: { type: "disabled" },
  });
  assert.deepEqual(claudeReasoningOptions("claude-haiku-4-5", "low"), {
    thinking: { type: "enabled", budgetTokens: 4_096 },
  });
});

test("Pi role tools map to a strict Claude tool allowlist", () => {
  assert.deepEqual(claudeToolsForRole(["read", "grep", "find", "ls"]), [
    "Read",
    "Grep",
    "Glob",
  ]);
  assert.throws(
    () => claudeToolsForRole(["read", "unknown"]),
    /unsupported tool "unknown"/,
  );
});
