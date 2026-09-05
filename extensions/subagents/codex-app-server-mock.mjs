#!/usr/bin/env node
/**
 * Deterministic Codex 0.153.4 app-server double. LF-delimited JSON-RPC on
 * stdio. Logs methods only; never prints account values or tokens.
 */
import * as fs from "node:fs";
import * as readline from "node:readline";

const scenario = process.env.CODEX_MOCK_SCENARIO ?? "valid-selection";
const logPath = process.env.CODEX_MOCK_LOG;
const SENTINEL = "SENTINEL_TOKEN_VALUE_9f3c";

function log(entry) {
  if (!logPath) return;
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function notify(method, params) {
  write({ method, params });
}

function model(slug, extra = {}) {
  const efforts = extra.efforts ?? ["medium"];
  return {
    id: extra.id ?? slug,
    model: extra.model ?? slug,
    displayName: slug,
    description: "",
    hidden: false,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
      reasoningEffort,
      description: reasoningEffort,
    })),
    defaultReasoningEffort: efforts[0],
    inputModalities: ["text"],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: extra.isDefault === true,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    modelSpecialty: null,
    multiAgentVersion: null,
  };
}

function threadResult(modelId) {
  return {
    thread: {
      id: "thread-1",
      path: "/tmp/codex-mock-thread.jsonl",
    },
    model: modelId,
    modelProvider: "openai",
  };
}

function turn(status, extra = {}) {
  return {
    id: extra.id ?? "turn-1",
    items: [],
    itemsView: "full",
    status,
    error: extra.error ?? null,
    startedAt: 1,
    completedAt: extra.completedAt ?? null,
    durationMs: extra.durationMs ?? null,
  };
}

function accountResult() {
  if (scenario === "missing-auth") {
    return { account: null, requiresOpenaiAuth: true };
  }
  if (scenario === "external-api-key") {
    return { account: null, requiresOpenaiAuth: false };
  }
  if (scenario === "chatgpt-oauth") {
    return {
      account: { type: "chatgpt", email: null, planType: "plus" },
      requiresOpenaiAuth: true,
    };
  }
  return { account: { type: "apiKey" }, requiresOpenaiAuth: true };
}

function agentMessage(text) {
  return {
    type: "agentMessage",
    id: "item-1",
    text,
    phase: "final_answer",
    memoryCitation: null,
    delivery: null,
    questions: null,
  };
}

function finishTurn(kind) {
  const threadId = "thread-1";
  const turnId = "turn-1";
  if (kind === "failed") {
    notify("turn/completed", {
      threadId,
      turn: turn("failed", {
        error: {
          message: "model crashed",
          codexErrorInfo: null,
          additionalDetails: null,
          misalignment: null,
        },
        completedAt: 2,
        durationMs: 10,
      }),
    });
    return;
  }
  if (kind === "inProgress") {
    notify("turn/completed", {
      threadId,
      turn: turn("inProgress", { completedAt: 2, durationMs: 10 }),
    });
    return;
  }
  if (kind === "interrupted") {
    notify("turn/completed", {
      threadId,
      turn: turn("interrupted", { completedAt: 2, durationMs: 10 }),
    });
    return;
  }
  if (kind === "commentary" || kind === "unphased") {
    notify("item/completed", {
      threadId,
      turnId,
      completedAtMs: 2,
      item: {
        ...agentMessage(
          kind === "commentary" ? "I will inspect the diff." : "No findings.",
        ),
        phase: kind === "commentary" ? "commentary" : null,
      },
    });
    notify("turn/completed", {
      threadId,
      turn: turn("completed", { completedAt: 2, durationMs: 10 }),
    });
    return;
  }
  if (kind === "empty") {
    notify("turn/completed", {
      threadId,
      turn: turn("completed", { completedAt: 2, durationMs: 10 }),
    });
    return;
  }
  if (kind === "whitespace") {
    notify("item/completed", {
      threadId,
      turnId,
      completedAtMs: 2,
      item: agentMessage("   \n\t"),
    });
    notify("turn/completed", {
      threadId,
      turn: turn("completed", { completedAt: 2, durationMs: 10 }),
    });
    return;
  }
  if (kind === "completed-with-error") {
    notify("item/completed", {
      threadId,
      turnId,
      completedAtMs: 2,
      item: agentMessage("looks like a review"),
    });
    notify("turn/completed", {
      threadId,
      turn: turn("completed", {
        error: {
          message: "hidden failure",
          codexErrorInfo: null,
          additionalDetails: null,
          misalignment: null,
        },
        completedAt: 2,
        durationMs: 10,
      }),
    });
    return;
  }
  if (kind === "error-then-completed") {
    notify("error", {
      error: {
        message: "provider 500",
        codexErrorInfo: "internalServerError",
        additionalDetails: null,
        misalignment: null,
      },
      willRetry: false,
      threadId,
      turnId,
    });
    notify("item/completed", {
      threadId,
      turnId,
      completedAtMs: 2,
      item: agentMessage("looks like a review"),
    });
    notify("turn/completed", {
      threadId,
      turn: turn("completed", { completedAt: 2, durationMs: 10 }),
    });
    return;
  }
  notify("item/completed", {
    threadId,
    turnId,
    completedAtMs: 2,
    item: agentMessage("hello codex"),
  });
  notify("turn/completed", {
    threadId,
    turn: turn("completed", { completedAt: 2, durationMs: 10 }),
  });
}

const turnKind = {
  "turn-failed": "failed",
  "turn-in-progress": "inProgress",
  "turn-interrupted": "interrupted",
  "turn-empty": "empty",
  "turn-commentary": "commentary",
  "turn-unphased": "unphased",
  "turn-whitespace": "whitespace",
  "turn-completed-with-error": "completed-with-error",
  "error-then-completed": "error-then-completed",
}[scenario];

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const method = message.method;
  const params = message.params ?? {};
  log({
    method,
    id: message.id,
    ...(method === "turn/start" ? { effort: params.effort } : {}),
  });
  if (method === "initialized" || message.id === undefined) return;

  const id = message.id;

  if (method === "initialize") {
    write({
      id,
      result: {
        userAgent: "codex-mock",
        codexHome: "/tmp/codex-mock-home",
        platformFamily: "unix",
        platformOs: "macos",
      },
    });
    return;
  }

  if (method === "account/read") {
    if (scenario === "account-secret-error") {
      write({
        id,
        error: { code: -32000, message: `account failed ${SENTINEL}` },
      });
      return;
    }
    if (scenario === "account-method-unavailable") {
      write({
        id,
        error: { code: -32601, message: `no such method ${SENTINEL}` },
      });
      return;
    }
    write({ id, result: accountResult() });
    return;
  }

  if (method === "model/list") {
    if (scenario === "discovery-timeout") return;
    if (scenario === "catalog-deadline") {
      setTimeout(
        () =>
          write({
            id,
            result: {
              data: [model("gpt-5.4")],
              nextCursor: params.cursor ? null : "page-2",
            },
          }),
        4_200,
      );
      return;
    }
    if (
      scenario === "discovery-failure" ||
      scenario === "catalog-secret-error"
    ) {
      write({
        id,
        error: { code: -32000, message: `model catalog ${SENTINEL}` },
      });
      return;
    }
    if (scenario === "catalog-method-unavailable") {
      write({
        id,
        error: { code: -32601, message: `no such method ${SENTINEL}` },
      });
      return;
    }
    if (scenario === "repeated-cursor") {
      write({
        id,
        result: { data: [model("gpt-5.1")], nextCursor: "loop" },
      });
      return;
    }
    if (scenario === "malformed-catalog") {
      write({ id, result: { data: "nope", nextCursor: null } });
      return;
    }
    if (scenario === "empty-catalog") {
      write({ id, result: { data: [], nextCursor: null } });
      return;
    }
    if (scenario === "pagination") {
      if (!params.cursor) {
        write({
          id,
          result: { data: [model("gpt-5.1")], nextCursor: "page-2" },
        });
        return;
      }
      write({
        id,
        result: {
          data: [model("gpt-5.4", { isDefault: true })],
          nextCursor: null,
        },
      });
      return;
    }
    if (scenario === "alias-id") {
      write({
        id,
        result: {
          data: [model("gpt-5.4", { id: "gpt-5.4-codex", isDefault: true })],
          nextCursor: null,
        },
      });
      return;
    }
    if (scenario === "omitted-model-effort") {
      write({
        id,
        result: {
          data: [
            model("gpt-5.1", { isDefault: true, efforts: ["medium"] }),
            model("gpt-5.4", { efforts: ["high", "medium"] }),
          ],
          nextCursor: null,
        },
      });
      return;
    }
    write({
      id,
      result: {
        data: [model("gpt-5.4", { isDefault: true }), model("gpt-5.1")],
        nextCursor: null,
      },
    });
    return;
  }

  if (method === "thread/start") {
    if (scenario === "missing-returned-model") {
      write({
        id,
        result: {
          thread: {
            id: "thread-1",
            path: "/tmp/codex-mock-thread.jsonl",
          },
          modelProvider: "openai",
        },
      });
      return;
    }
    if (scenario === "omitted-unlisted-model") {
      write({ id, result: threadResult("gpt-unlisted") });
      return;
    }
    if (scenario === "alias-id") {
      write({ id, result: threadResult("gpt-5.4") });
      return;
    }
    if (scenario === "omitted-model-effort") {
      write({ id, result: threadResult("gpt-5.4") });
      return;
    }
    const requested = params.model ?? "gpt-5.4";
    const returned = scenario === "silent-substitution" ? "gpt-5.1" : requested;
    write({ id, result: threadResult(returned) });
    return;
  }

  if (method === "turn/start") {
    write({ id, result: { turn: turn("inProgress") } });
    queueMicrotask(() => finishTurn(turnKind ?? "completed"));
    return;
  }

  if (method === "turn/interrupt") {
    write({ id, result: {} });
    return;
  }

  write({
    id,
    error: { code: -32601, message: `unexpected method ${method}` },
  });
});
