import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SubagentSnapshot } from "./src/domain.ts";
import {
  reconcileDashboardSelection,
  type DashboardSelection,
} from "./src/ui/takeover.ts";
import { buildTranscriptLines } from "./src/ui/transcript.ts";

test("dashboard selection follows its subagent id and falls back by row", () => {
  const selection: DashboardSelection = { id: "sa-7", index: 6 };

  reconcileDashboardSelection(selection, [
    { id: "sa-new" },
    ...Array.from({ length: 8 }, (_, index) => ({ id: `sa-${index + 1}` })),
  ]);
  assert.deepEqual(selection, { id: "sa-7", index: 7 });

  reconcileDashboardSelection(selection, [
    ...Array.from({ length: 6 }, (_, index) => ({ id: `sa-${index + 1}` })),
    { id: "sa-8" },
    { id: "sa-9" },
  ]);
  assert.deepEqual(selection, { id: "sa-9", index: 7 });

  reconcileDashboardSelection(selection, [{ id: "sa-1" }, { id: "sa-2" }]);
  assert.deepEqual(selection, { id: "sa-2", index: 1 });

  reconcileDashboardSelection(selection, []);
  assert.deepEqual(selection, { id: undefined, index: 0 });
});

test("subagent transcripts hide reasoning by default and reveal it on demand", () => {
  const theme = {
    fg: (_color: string, text: string) => text,
    italic: (text: string) => text,
  } as unknown as Theme;
  const snap = {
    id: "sa-1",
    backend: "claude",
    title: "explore",
    prompt: "inspect",
    cwd: "/workspace",
    status: "done",
    createdAt: 0,
    meta: { backend: "claude" },
    usage: {},
    transcript: [
      {
        kind: "assistant",
        parts: [
          { type: "thinking", text: "private reasoning" },
          { type: "text", text: "concise result" },
        ],
      },
      {
        kind: "toolResult",
        toolId: "tool-1",
        name: "Read",
        isError: false,
        outputPreview: "one-line preview",
      },
    ],
    liveTools: [],
    queued: [],
    finalText: "concise result",
    turns: 1,
    runSequence: 1,
  } as SubagentSnapshot;

  const collapsed = buildTranscriptLines(snap, 100, theme);
  assert.doesNotMatch(collapsed.join("\n"), /private reasoning/);
  assert.match(collapsed.join("\n"), /concise result/);
  assert.match(collapsed.join("\n"), /one-line preview/);

  const expanded = buildTranscriptLines(snap, 100, theme, {
    showThinking: true,
  });
  assert.match(expanded.join("\n"), /private reasoning/);
});
