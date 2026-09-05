/**
 * Codex 0.153.4 app-server protocol: account/read, paginated model/list,
 * thread/start model verification, and TurnStatus settlement.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Effect, Stream } from "effect";
import type { SubagentSession } from "./src/backend.ts";
import { codexBackend } from "./src/backends/codex.ts";
import type { ParentContext, SpawnTask, SubagentEvent } from "./src/domain.ts";

const parent: ParentContext = {
  parentCwd: process.cwd(),
  projectTrusted: false,
};

const SENTINEL = "SENTINEL_TOKEN_VALUE_9f3c";
const mockSource = fileURLToPath(
  new URL("./codex-app-server-mock.mjs", import.meta.url),
);
const originalPath = process.env.PATH ?? "";
const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-protocol-bin-"));
const fakeBinary = path.join(fakeDir, "codex");
fs.copyFileSync(mockSource, fakeBinary);
fs.chmodSync(fakeBinary, 0o755);
process.env.PATH = `${fakeDir}${path.delimiter}${originalPath}`;

test.after(() => {
  process.env.PATH = originalPath;
  fs.rmSync(fakeDir, { recursive: true, force: true });
});

function task(overrides: Partial<SpawnTask> = {}): SpawnTask {
  return {
    prompt: "Reply with exactly: hello codex",
    title: "codex protocol test",
    cwd: process.cwd(),
    parent,
    ...overrides,
  };
}

function assertNoAccountSecrets(text: string) {
  assert.doesNotMatch(text, /@/);
  assert.doesNotMatch(text, /email/i);
  assert.doesNotMatch(text, /authToken/i);
  assert.doesNotMatch(text, /sk-[a-zA-Z0-9]/);
}

function methodsFrom(logFile: string) {
  if (!fs.existsSync(logFile)) return [];
  return fs
    .readFileSync(logFile, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { method?: string })
    .map((entry) => entry.method)
    .filter((method): method is string => typeof method === "string");
}

function withScenario<T>(
  scenario: string,
  run: (logFile: string) => Promise<T>,
) {
  const logFile = path.join(
    os.tmpdir(),
    `codex-protocol-${scenario}-${process.pid}-${Date.now()}.log`,
  );
  const previousScenario = process.env.CODEX_MOCK_SCENARIO;
  const previousLog = process.env.CODEX_MOCK_LOG;
  process.env.CODEX_MOCK_SCENARIO = scenario;
  process.env.CODEX_MOCK_LOG = logFile;
  return run(logFile).finally(() => {
    if (previousScenario === undefined) delete process.env.CODEX_MOCK_SCENARIO;
    else process.env.CODEX_MOCK_SCENARIO = previousScenario;
    if (previousLog === undefined) delete process.env.CODEX_MOCK_LOG;
    else process.env.CODEX_MOCK_LOG = previousLog;
    fs.rmSync(logFile, { force: true });
  });
}

async function spawnFailure(spawnTask: SpawnTask) {
  try {
    await Effect.runPromise(Effect.scoped(codexBackend.spawn(spawnTask)));
    throw new Error("expected Codex spawn to fail");
  } catch (error) {
    assert.notEqual(
      error instanceof Error ? error.message : String(error),
      "expected Codex spawn to fail",
    );
    return error instanceof Error ? error : new Error(String(error));
  }
}

function settledOutcome(events: ReadonlyArray<SubagentEvent>) {
  const settled = events.find((event) => event._tag === "RunSettled");
  assert.ok(settled, "expected a RunSettled event");
  return settled.outcome;
}

async function spawnAndCollect(spawnTask: SpawnTask, timeoutMs = 2_000) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const session: SubagentSession = yield* codexBackend.spawn(spawnTask);
        const events: SubagentEvent[] = [];
        yield* Stream.runForEach(session.events, (event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ).pipe(Effect.forkScoped);
        const deadline = Date.now() + timeoutMs;
        while (!events.some((event) => event._tag === "RunSettled")) {
          if (Date.now() > deadline) {
            return yield* Effect.fail(
              new Error("Timed out waiting for Codex RunSettled"),
            );
          }
          yield* Effect.sleep("15 millis");
        }
        return { events, meta: yield* session.meta };
      }),
    ),
  );
}

test.describe(
  "Codex app-server preflight and turn settlement",
  { concurrency: 1 },
  () => {
    test(
      "catalog discovery deadline covers every page, including the final response",
      { timeout: 15_000 },
      async () => {
        await withScenario("catalog-deadline", async (logFile) => {
          const error = await spawnFailure(task({ model: "gpt-5.4" }));
          assert.match(error.message, /discovery failed: timed out/);
          assert.ok(!methodsFrom(logFile).includes("thread/start"));
        });
      },
    );

    test("rejects an unsupported model before thread/start", async () => {
      await withScenario("chatgpt-oauth", async (logFile) => {
        const error = await spawnFailure(task({ model: "gpt-nope" }));
        assert.match(error.message, /Unsupported Codex model "gpt-nope"/);
        assert.match(error.message, /gpt-5\.4/);
        assert.match(error.message, /does not guarantee entitlement/);
        assertNoAccountSecrets(error.message);
        const methods = methodsFrom(logFile);
        assert.ok(methods.includes("account/read"));
        assert.ok(methods.includes("model/list"));
        assert.ok(!methods.includes("thread/start"));
      });
    });

    test("rejects missing OpenAI auth before thread/start", async () => {
      await withScenario("missing-auth", async (logFile) => {
        const error = await spawnFailure(task({ model: "gpt-5.4" }));
        assert.match(error.message, /no usable Codex account/i);
        assertNoAccountSecrets(error.message);
        const methods = methodsFrom(logFile);
        assert.ok(methods.includes("account/read"));
        assert.ok(!methods.includes("thread/start"));
      });
    });

    test("accepts an explicit catalog model after auth and registry preflight", async () => {
      await withScenario("valid-selection", async (logFile) => {
        const { events, meta } = await spawnAndCollect(
          task({ model: "gpt-5.4" }),
        );
        assert.deepEqual(settledOutcome(events), {
          _tag: "Completed",
          finalText: "hello codex",
        });
        assert.equal(meta.modelLabel, "gpt-5.4");
        const methods = methodsFrom(logFile);
        const accountAt = methods.indexOf("account/read");
        const listAt = methods.indexOf("model/list");
        const threadAt = methods.indexOf("thread/start");
        assert.ok(accountAt >= 0 && listAt >= 0 && threadAt >= 0);
        assert.ok(accountAt < threadAt);
        assert.ok(listAt < threadAt);
      });
    });

    test("accepts account/read null when OpenAI auth is not required", async () => {
      await withScenario("external-api-key", async (logFile) => {
        const { events } = await spawnAndCollect(task({ model: "gpt-5.4" }));
        assert.equal(settledOutcome(events)._tag, "Completed");
        assert.ok(methodsFrom(logFile).includes("account/read"));
      });
    });

    test("pages the model catalog until the requested model is found", async () => {
      await withScenario("pagination", async (logFile) => {
        const { events } = await spawnAndCollect(task({ model: "gpt-5.4" }));
        assert.equal(settledOutcome(events)._tag, "Completed");
        const listed = fs
          .readFileSync(logFile, "utf8")
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line) as { method?: string; id?: number });
        const listCount = listed.filter(
          (entry) => entry.method === "model/list",
        ).length;
        assert.equal(listCount, 2);
        assert.ok(listed.some((entry) => entry.method === "thread/start"));
      });
    });

    test("fails spawn when model catalog discovery errors, without thread/start", async () => {
      await withScenario("discovery-failure", async (logFile) => {
        const error = await spawnFailure(task({ model: "gpt-5.4" }));
        assert.match(error.message, /model catalog/i);
        assert.match(error.message, /unavailable/);
        assert.doesNotMatch(error.message, /retry/i);
        assert.doesNotMatch(error.message, new RegExp(SENTINEL));
        assert.ok(!methodsFrom(logFile).includes("thread/start"));
      });
    });

    test(
      "fails spawn when model catalog discovery times out, without thread/start",
      { timeout: 15_000 },
      async () => {
        await withScenario("discovery-timeout", async (logFile) => {
          const error = await spawnFailure(task({ model: "gpt-5.4" }));
          assert.match(error.message, /model catalog/i);
          assert.match(error.message, /timed out/i);
          assert.doesNotMatch(error.message, /retry/i);
          assert.ok(!methodsFrom(logFile).includes("thread/start"));
        });
      },
    );

    test("rejects silent model substitution from thread/start", async () => {
      await withScenario("silent-substitution", async () => {
        const error = await spawnFailure(task({ model: "gpt-5.4" }));
        assert.match(error.message, /substituted/i);
        assert.match(error.message, /gpt-5\.1/);
        assert.match(error.message, /gpt-5\.4/);
      });
    });

    test("failed turn status cannot settle as Completed", async () => {
      await withScenario("turn-failed", async () => {
        const { events } = await spawnAndCollect(task({ model: "gpt-5.4" }));
        const outcome = settledOutcome(events);
        assert.equal(outcome._tag, "Failed");
        assert.match(outcome.errorText, /model crashed/);
      });
    });

    test("inProgress turn/completed cannot settle as Completed", async () => {
      await withScenario("turn-in-progress", async () => {
        const { events } = await spawnAndCollect(task({ model: "gpt-5.4" }));
        const outcome = settledOutcome(events);
        assert.equal(outcome._tag, "Failed");
        assert.match(outcome.errorText, /inProgress/);
      });
    });

    test("interrupted turn status settles as Interrupted", async () => {
      await withScenario("turn-interrupted", async () => {
        const { events } = await spawnAndCollect(task({ model: "gpt-5.4" }));
        assert.equal(settledOutcome(events)._tag, "Interrupted");
      });
    });

    test("commentary-only completed turn cannot settle as review proof", async () => {
      await withScenario("turn-commentary", async () => {
        const { events } = await spawnAndCollect(task({ model: "gpt-5.4" }));
        const outcome = settledOutcome(events);
        assert.equal(outcome._tag, "Failed");
        assert.match(outcome.errorText, /final assistant message/i);
      });
    });

    test("completed unphased model output remains compatible with nullable protocol phase", async () => {
      await withScenario("turn-unphased", async () => {
        const { events } = await spawnAndCollect(task({ model: "gpt-5.4" }));
        assert.deepEqual(settledOutcome(events), {
          _tag: "Completed",
          finalText: "No findings.",
        });
      });
    });

    test("empty completed turn cannot settle as review proof", async () => {
      await withScenario("turn-empty", async () => {
        const { events } = await spawnAndCollect(task({ model: "gpt-5.4" }));
        const outcome = settledOutcome(events);
        assert.equal(outcome._tag, "Failed");
        assert.match(outcome.errorText, /final assistant message/i);
      });
    });

    test("error notification then completed cannot settle as review proof", async () => {
      await withScenario("error-then-completed", async () => {
        const { events } = await spawnAndCollect(task({ model: "gpt-5.4" }));
        const outcome = settledOutcome(events);
        assert.equal(outcome._tag, "Failed");
        assert.match(outcome.errorText, /provider 500/);
      });
    });

    test("account/read errors stay classified and omit sentinel secrets", async () => {
      await withScenario("account-secret-error", async (logFile) => {
        const error = await spawnFailure(task({ model: "gpt-5.4" }));
        assert.match(error.message, /account discovery failed/i);
        assert.match(error.message, /unavailable/);
        assert.doesNotMatch(error.message, new RegExp(SENTINEL));
        assertNoAccountSecrets(error.message);
        assert.ok(!methodsFrom(logFile).includes("thread/start"));
      });
    });

    test("account/read method-not-found stays classified and omit sentinel secrets", async () => {
      await withScenario("account-method-unavailable", async () => {
        const error = await spawnFailure(task({ model: "gpt-5.4" }));
        assert.match(error.message, /account discovery failed/i);
        assert.match(error.message, /method unavailable/);
        assert.doesNotMatch(error.message, new RegExp(SENTINEL));
      });
    });

    test("model/list errors stay classified and omit sentinel secrets", async () => {
      await withScenario("catalog-secret-error", async () => {
        const error = await spawnFailure(task({ model: "gpt-5.4" }));
        assert.match(error.message, /model catalog/i);
        assert.match(error.message, /unavailable/);
        assert.doesNotMatch(error.message, new RegExp(SENTINEL));
        assert.doesNotMatch(error.message, /Unsupported Codex model/);
      });
    });

    test("model/list method-not-found stays classified and omit sentinel secrets", async () => {
      await withScenario("catalog-method-unavailable", async () => {
        const error = await spawnFailure(task({ model: "gpt-5.4" }));
        assert.match(error.message, /model catalog/i);
        assert.match(error.message, /method unavailable/);
        assert.doesNotMatch(error.message, new RegExp(SENTINEL));
      });
    });

    test("repeated catalog cursors fail as malformed discovery, not unsupported model", async () => {
      await withScenario("repeated-cursor", async (logFile) => {
        const error = await spawnFailure(task({ model: "gpt-5.4" }));
        assert.match(error.message, /model catalog/i);
        assert.match(error.message, /malformed/);
        assert.doesNotMatch(error.message, /Unsupported Codex model/);
        const listCount = methodsFrom(logFile).filter(
          (method) => method === "model/list",
        ).length;
        assert.ok(listCount <= 2);
        assert.ok(!methodsFrom(logFile).includes("thread/start"));
      });
    });

    test("malformed catalog data fails as discovery, not unsupported model", async () => {
      await withScenario("malformed-catalog", async (logFile) => {
        const error = await spawnFailure(task({ model: "gpt-5.4" }));
        assert.match(error.message, /model catalog/i);
        assert.match(error.message, /malformed/);
        assert.doesNotMatch(error.message, /Unsupported Codex model/);
        assert.ok(!methodsFrom(logFile).includes("thread/start"));
      });
    });

    test("empty catalog fails as discovery, not unsupported model", async () => {
      await withScenario("empty-catalog", async () => {
        const error = await spawnFailure(task({ model: "gpt-5.4" }));
        assert.match(error.message, /model catalog/i);
        assert.match(error.message, /malformed/);
        assert.doesNotMatch(error.message, /Unsupported Codex model/);
      });
    });

    test("omitted model still requires thread/start.model in the catalog", async () => {
      await withScenario("valid-selection", async () => {
        const { events, meta } = await spawnAndCollect(task());
        assert.equal(settledOutcome(events)._tag, "Completed");
        assert.equal(meta.modelLabel, "gpt-5.4");
      });
    });

    test("omitted model rejects a returned model absent from the catalog", async () => {
      await withScenario("omitted-unlisted-model", async () => {
        const error = await spawnFailure(task());
        assert.match(error.message, /not in the verified catalog/);
        assert.doesNotMatch(error.message, /Unsupported Codex model/);
      });
    });

    test("thread/start with no model cannot verify the honored choice", async () => {
      await withScenario("missing-returned-model", async () => {
        const error = await spawnFailure(task({ model: "gpt-5.4" }));
        assert.match(error.message, /returned no model/i);
      });
    });

    test("catalog id and model slug aliases are the same selection", async () => {
      await withScenario("alias-id", async () => {
        const { events, meta } = await spawnAndCollect(
          task({ model: "gpt-5.4-codex" }),
        );
        assert.equal(settledOutcome(events)._tag, "Completed");
        assert.equal(meta.modelLabel, "gpt-5.4");
      });
    });

    test("omitted model maps effort from the returned catalog model, not the default entry", async () => {
      await withScenario("omitted-model-effort", async (logFile) => {
        const { events } = await spawnAndCollect(
          task({ reasoningEffort: "high" }),
        );
        assert.equal(settledOutcome(events)._tag, "Completed");
        const turnStart = fs
          .readFileSync(logFile, "utf8")
          .split("\n")
          .filter((line) => line.trim())
          .map(
            (line) => JSON.parse(line) as { method?: string; effort?: string },
          )
          .find((entry) => entry.method === "turn/start");
        assert.equal(turnStart?.effort, "high");
      });
    });

    test("whitespace-only completed turn cannot settle as review proof", async () => {
      await withScenario("turn-whitespace", async () => {
        const { events } = await spawnAndCollect(task({ model: "gpt-5.4" }));
        const outcome = settledOutcome(events);
        assert.equal(outcome._tag, "Failed");
        assert.match(outcome.errorText, /final assistant message/i);
      });
    });

    test("completed turn with an error payload cannot settle as review proof", async () => {
      await withScenario("turn-completed-with-error", async () => {
        const { events } = await spawnAndCollect(task({ model: "gpt-5.4" }));
        const outcome = settledOutcome(events);
        assert.equal(outcome._tag, "Failed");
      });
    });
  },
);
