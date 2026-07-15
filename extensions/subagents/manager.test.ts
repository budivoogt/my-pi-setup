/**
 * End-to-end smoke tests: manager behavior through a real ManagedRuntime,
 * exactly as the tool handlers drive it. The registry is test-only: scripted
 * stub sessions registered under the claude/codex names (the production
 * backends launch real processes and have their own live test files), plus
 * the real pi backend for its cheap registry precondition.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import { BackendRegistry, type SubagentBackend } from "./src/backend.ts";
import { piBackend } from "./src/backends/pi.ts";
import { makeStubBackend } from "./src/backends/stub.ts";
import type { BackendName, ParentContext, SpawnTask } from "./src/domain.ts";
import {
  SubagentManager,
  SubagentManagerLive,
  type SubagentManagerShape,
} from "./src/manager.ts";
import { runTool } from "./src/runtime.ts";

const TestRegistryLive = Layer.sync(BackendRegistry, () => {
  const backends: SubagentBackend[] = [
    piBackend,
    makeStubBackend({
      backend: "claude",
      defaultModelLabel: "claude/sonnet",
      contextWindow: 200_000,
      toolName: "Bash",
      cadenceMs: 40,
    }),
    makeStubBackend({
      backend: "codex",
      defaultModelLabel: "codex/gpt-5-codex",
      contextWindow: 272_000,
      toolName: "shell",
      cadenceMs: 30,
    }),
  ];
  return new Map<BackendName, SubagentBackend>(
    backends.map((backend) => [backend.name, backend]),
  );
});

const createTestRuntime = () =>
  ManagedRuntime.make(
    SubagentManagerLive.pipe(Layer.provide(TestRegistryLive)),
  );

const parent: ParentContext = {
  parentCwd: process.cwd(),
  projectTrusted: false,
};

function task(prompt: string): SpawnTask {
  return { prompt, title: "test", cwd: process.cwd(), parent };
}

async function withManager(
  run: (
    manager: SubagentManagerShape,
    runtime: ReturnType<typeof createTestRuntime>,
  ) => Promise<void>,
) {
  const runtime = createTestRuntime();
  try {
    const manager = await runtime.runPromise(SubagentManager);
    await run(manager, runtime);
  } finally {
    await runtime.dispose();
  }
}

test("stub subagent completes and delivers a final result", async () => {
  await withManager(async (manager, runtime) => {
    const settled: Array<{ id: string; consumed: boolean }> = [];
    manager.view.setOnSettled((snap, consumed) =>
      settled.push({ id: snap.id, consumed }),
    );

    const snap = await runTool(
      runtime,
      manager.spawn("claude", task("Say hello to the tests")),
    );
    assert.equal(snap.status, "running");
    assert.equal(snap.backend, "claude");
    assert.ok(snap.meta.sessionFilePath);

    await runTool(runtime, manager.waitFor([snap.id]));
    const done = manager.view.get(snap.id);
    assert.ok(done);
    assert.equal(done.status, "done");
    assert.match(
      done.finalText,
      /\[stub:claude\] completed: Say hello to the tests/,
    );
    assert.ok(done.turns >= 2);
    assert.ok(done.transcript.some((item) => item.kind === "toolResult"));
    // The waitFor marked the settle as consumed.
    assert.deepEqual(settled, [{ id: snap.id, consumed: true }]);
  });
});

test("FAIL: prompts settle as errors; unconsumed settles are delivered", async () => {
  await withManager(async (manager, runtime) => {
    const settled: Array<{ id: string; consumed: boolean }> = [];
    manager.view.setOnSettled((snap, consumed) =>
      settled.push({ id: snap.id, consumed }),
    );

    const snap = await runTool(
      runtime,
      manager.spawn("codex", task("FAIL: blow up please")),
    );
    // Poll without wait-interest so the settle is delivered unconsumed.
    while (manager.view.get(snap.id)?.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const failed = manager.view.get(snap.id);
    assert.equal(failed?.status, "error");
    assert.match(failed?.errorText ?? "", /task failed/);
    assert.deepEqual(settled, [{ id: snap.id, consumed: false }]);
  });
});

test("cancel interrupts a running stub subagent", async () => {
  await withManager(async (manager, runtime) => {
    const snap = await runTool(
      runtime,
      manager.spawn("claude", task("Long running task")),
    );
    const report = await runTool(runtime, manager.cancel([snap.id]));
    assert.deepEqual(report, [
      { id: snap.id, title: "test", status: "error", cancelled: true },
    ]);
    assert.equal(manager.view.get(snap.id)?.errorText, "Run was aborted");
  });
});

test("the concurrency cap rejects a fifth running subagent", async () => {
  await withManager(async (manager, runtime) => {
    const spawns = await runTool(
      runtime,
      Effect.forEach(
        [1, 2, 3, 4],
        (n) => manager.spawn("codex", task(`Task ${n}`)),
        { concurrency: "unbounded" },
      ),
    );
    assert.equal(spawns.length, 4);
    await assert.rejects(
      runTool(runtime, manager.spawn("codex", task("Task 5"))),
      /Max 4 subagents/,
    );
  });
});

test("simultaneous spawns reserve exactly four slots", async () => {
  await withManager(async (manager, runtime) => {
    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((n) =>
        runTool(runtime, manager.spawn("codex", task(`Concurrent ${n}`))),
      ),
    );
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      4,
    );
    const [rejected] = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    assert.match(String(rejected.reason), /Max 4 subagents/);
  });
});

test("pi spawn fails fast without the parent model registry", async () => {
  await withManager(async (manager, runtime) => {
    await assert.rejects(
      runTool(runtime, manager.spawn("pi", task("needs a registry"))),
      /model registry/,
    );
    // The failed spawn must release its concurrency reservation.
    const snap = await runTool(runtime, manager.spawn("codex", task("ok")));
    assert.equal(snap.backend, "codex");
  });
});

test("idle restarts respect the concurrency cap", async () => {
  await withManager(async (manager, runtime) => {
    // Settle one subagent, then fill all four slots with running ones.
    const settled = await runTool(
      runtime,
      manager.spawn("claude", task("early finisher")),
    );
    await runTool(runtime, manager.waitFor([settled.id]));
    await runTool(
      runtime,
      Effect.forEach(
        [1, 2, 3, 4],
        (n) => manager.spawn("codex", task(`Task ${n}`)),
        { concurrency: "unbounded" },
      ),
    );
    // Restarting the settled one would be a fifth concurrent run.
    await assert.rejects(
      runTool(runtime, manager.send(settled.id, "go again")),
      /Max 4 subagents/,
    );
    assert.equal(manager.view.get(settled.id)?.status, "done");
  });
});

test("send steers an idle subagent into another turn", async () => {
  await withManager(async (manager, runtime) => {
    const snap = await runTool(
      runtime,
      manager.spawn("claude", task("First turn")),
    );
    await runTool(runtime, manager.waitFor([snap.id]));
    const afterFirst = manager.view.get(snap.id);
    assert.equal(afterFirst?.status, "done");

    await runTool(runtime, manager.send(snap.id, "Second turn"));
    // Waiting immediately must observe the reserved restart before the
    // RunStarted event has reached the manager pump.
    await runTool(runtime, manager.waitFor([snap.id]));
    const afterSecond = manager.view.get(snap.id);
    assert.equal(afterSecond?.status, "done");
    assert.match(afterSecond?.finalText ?? "", /Second turn/);
  });
});

test("close interrupts a running child, removes it, and rejects later sends", async () => {
  await withManager(async (manager, runtime) => {
    const snap = await runTool(
      runtime,
      manager.spawn("codex", task("Keep running until closed")),
    );
    const closed = await runTool(runtime, manager.close(snap.id));
    assert.deepEqual(closed, {
      id: snap.id,
      title: "test",
      status: "error",
      interrupted: true,
      finalText: "",
      errorText: "Run was aborted",
    });
    assert.equal(manager.view.get(snap.id), undefined);
    await assert.rejects(
      runTool(runtime, manager.send(snap.id, "too late")),
      /no longer tracked/,
    );
    assert.equal(await runTool(runtime, manager.close(snap.id)), undefined);
  });
});

test("close releases an idle persistent child without interrupting it", async () => {
  await withManager(async (manager, runtime) => {
    const withRole: SpawnTask = {
      ...task("Finish, then close"),
      role: {
        name: "explorer",
        developerInstructions: "Read only.",
        tools: ["read"],
      },
    };
    const snap = await runTool(runtime, manager.spawn("claude", withRole));
    assert.equal(snap.role, "explorer");
    await runTool(runtime, manager.waitFor([snap.id]));
    const closed = await runTool(runtime, manager.close(snap.id));
    assert.equal(closed?.interrupted, false);
    assert.equal(closed?.status, "done");
    assert.equal(manager.view.get(snap.id), undefined);
  });
});

test("close serializes concurrent send and duplicate close operations", async () => {
  await withManager(async (manager, runtime) => {
    const snap = await runTool(
      runtime,
      manager.spawn("codex", task("Close race")),
    );
    const [closed, sent, duplicate] = await Promise.allSettled([
      runTool(runtime, manager.close(snap.id)),
      runTool(runtime, manager.send(snap.id, "must be rejected")),
      runTool(runtime, manager.close(snap.id)),
    ]);
    assert.equal(closed.status, "fulfilled");
    assert.equal(sent.status, "rejected");
    if (sent.status === "rejected") {
      assert.match(String(sent.reason), /closing/);
    }
    assert.deepEqual(duplicate, { status: "fulfilled", value: undefined });
    assert.equal(manager.view.get(snap.id), undefined);
  });
});

test("cancel serializes a concurrent send until interruption settles", async () => {
  await withManager(async (manager, runtime) => {
    const snap = await runTool(
      runtime,
      manager.spawn("claude", task("Cancel race")),
    );
    const [cancelled, sent] = await Promise.allSettled([
      runTool(runtime, manager.cancel([snap.id])),
      runTool(runtime, manager.send(snap.id, "must not restart yet")),
    ]);
    assert.equal(cancelled.status, "fulfilled");
    assert.equal(sent.status, "rejected");
    if (sent.status === "rejected") {
      assert.match(String(sent.reason), /being interrupted/);
    }
    assert.equal(manager.view.get(snap.id)?.status, "error");
  });
});

test("a concurrent wait captures the terminal snapshot before close removes it", async () => {
  await withManager(async (manager, runtime) => {
    const snap = await runTool(
      runtime,
      manager.spawn("codex", task("Wait and close")),
    );
    const [waited, closed] = await Promise.all([
      runTool(runtime, manager.waitFor([snap.id])),
      runTool(runtime, manager.close(snap.id)),
    ]);
    assert.equal(waited[0]?.id, snap.id);
    assert.equal(waited[0]?.status, "error");
    assert.equal(closed?.id, snap.id);
    assert.equal(manager.view.get(snap.id), undefined);
  });
});
