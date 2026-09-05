/**
 * Codex backend — real implementation over `codex app-server`.
 *
 * One scoped app-server process owns one persistent Codex thread. The server
 * speaks LF-delimited JSON-RPC over stdio: initialize, account/read, paginated
 * model/list, thread/start, and turn/start drive runs; v2 item notifications
 * are translated into normalized
 * SubagentEvents. send() queues a follow-up turn while busy, and interrupt uses
 * turn/interrupt with a local deadline so a missing server acknowledgement can
 * never leave the manager stuck in "running".
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Cause, Scope } from "effect";
import { Effect, Queue, Stream } from "effect";
import type { SubagentBackend, SubagentSession } from "../backend.ts";
import type {
  ReasoningEffort,
  RunOutcome,
  SpawnTask,
  SubagentEvent,
  SubagentMeta,
  TranscriptPart,
} from "../domain.ts";
import { SendError, SpawnError } from "../domain.ts";

const REQUEST_TIMEOUT_MS = 30_000;
const MODEL_LIST_TIMEOUT_MS = 5_000;
const MODEL_LIST_DEADLINE_MS = 8_000;
const MAX_MODEL_LIST_PAGES = 32;
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const INTERRUPT_FALLBACK_MS = 1_500;
const FORCE_KILL_AFTER_MS = 2_000;
const PREVIEW_MAX_LENGTH = 1_024;
/** A protocol line larger than this without a newline means a broken peer. */
const STDOUT_BUFFER_MAX_BYTES = 4 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;

interface PendingRequest {
  readonly resolve: (result: JsonRecord) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface ToolState {
  readonly name: string;
  output: string;
}

// --- Binary + protocol helpers -----------------------------------------------

let cachedCodexBinary: string | null | undefined;

function executable(file: string) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve once on first use; availability checks after that are allocation-only. */
function resolveCodexBinary() {
  if (cachedCodexBinary !== undefined) return cachedCodexBinary ?? undefined;
  const names =
    process.platform === "win32" ? ["codex.exe", "codex.cmd"] : ["codex"];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (executable(candidate)) {
        cachedCodexBinary = candidate;
        return candidate;
      }
    }
  }
  cachedCodexBinary = null;
  return undefined;
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function records(value: unknown) {
  return Array.isArray(value)
    ? value.map(record).filter((item): item is JsonRecord => item !== undefined)
    : [];
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function safeJson(value: unknown) {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : text.slice(0, PREVIEW_MAX_LENGTH);
  } catch {
    return undefined;
  }
}

function firstLine(value: unknown) {
  if (typeof value !== "string") return undefined;
  const line = value.split("\n").find((candidate) => candidate.trim());
  return line?.trim().slice(0, PREVIEW_MAX_LENGTH);
}

function boundedError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    4096,
  );
}

function protocolError(value: unknown) {
  const error = record(value);
  const message = stringValue(error?.message);
  return boundedError(
    message ?? safeJson(value) ?? "Codex app-server request failed",
  );
}

/** 0.144.3 accepts these effort slugs; individual models expose a subset. */
function preferredCodexEffort(effort: ReasoningEffort | undefined) {
  switch (effort) {
    case "off":
    case "minimal":
      return "minimal";
    case "low":
    case "medium":
    case "high":
      return effort;
    case "xhigh":
    case "max":
      return "xhigh";
    case undefined:
      return undefined;
  }
}

function catalogEntry(models: ReadonlyArray<JsonRecord>, label: string) {
  return models.find(
    (candidate) =>
      stringValue(candidate.id) === label ||
      stringValue(candidate.model) === label,
  );
}

function catalogKey(entry: JsonRecord) {
  return stringValue(entry.id) ?? stringValue(entry.model);
}

function catalogModelIds(models: ReadonlyArray<JsonRecord>) {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const id = stringValue(model.model) ?? stringValue(model.id);
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function sameCatalogSelection(
  left: string,
  right: string,
  models: ReadonlyArray<JsonRecord>,
) {
  const requested = catalogEntry(models, left);
  const returned = catalogEntry(models, right);
  if (!requested || !returned) return false;
  return catalogKey(requested) === catalogKey(returned);
}

function rpcCode(error: unknown) {
  return error instanceof Error
    ? numberValue((error as { jsonRpcCode?: unknown }).jsonRpcCode)
    : undefined;
}

function classifiedDiscoveryFailure(
  kind: "account" | "catalog",
  error: unknown,
) {
  const prefix =
    kind === "account"
      ? "Codex account discovery failed"
      : "Codex model catalog discovery failed";
  const action =
    "Check the selected Codex configuration home and CLI version, then refresh discovery before launching.";
  const text = error instanceof Error ? error.message : "";
  if (text.includes(" timed out."))
    return new Error(`${prefix}: timed out. ${action}`);
  if (rpcCode(error) === JSON_RPC_METHOD_NOT_FOUND) {
    return new Error(`${prefix}: method unavailable. ${action}`);
  }
  return new Error(`${prefix}: unavailable. ${action}`);
}

/**
 * `account/read` may return null when OpenAI auth is not required (external
 * API-key / custom-provider config). Do not treat that as missing auth, and
 * never include account fields in errors.
 */
function accountIsUsable(result: JsonRecord) {
  const account = record(result.account);
  if (account) {
    const type = stringValue(account.type);
    return type === "apiKey" || type === "chatgpt" || type === "amazonBedrock";
  }
  return booleanValue(result.requiresOpenaiAuth) === false;
}

async function listCodexCatalog(
  request: (
    method: string,
    params: JsonRecord,
    timeoutMs?: number,
  ) => Promise<JsonRecord>,
) {
  const models: JsonRecord[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  const deadline = Date.now() + MODEL_LIST_DEADLINE_MS;
  for (let page = 0; page < MAX_MODEL_LIST_PAGES; page++) {
    if (Date.now() >= deadline) {
      throw new Error("Codex model catalog discovery failed: timed out.");
    }
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error("Codex model catalog discovery failed: malformed.");
      }
      seenCursors.add(cursor);
    }
    const params: JsonRecord = { includeHidden: true };
    if (cursor) params.cursor = cursor;
    let result: JsonRecord;
    try {
      result = await request(
        "model/list",
        params,
        Math.max(1, Math.min(MODEL_LIST_TIMEOUT_MS, deadline - Date.now())),
      );
      if (Date.now() >= deadline) {
        throw new Error("Codex model/list timed out.");
      }
    } catch (error) {
      throw classifiedDiscoveryFailure("catalog", error);
    }
    if (!Array.isArray(result.data)) {
      throw new Error("Codex model catalog discovery failed: malformed.");
    }
    models.push(
      ...records(result.data).filter(
        (entry) =>
          stringValue(entry.id) !== undefined ||
          stringValue(entry.model) !== undefined,
      ),
    );
    const nextRaw = result.nextCursor;
    if (nextRaw === undefined || nextRaw === null || nextRaw === "") {
      if (models.length === 0) {
        throw new Error("Codex model catalog discovery failed: malformed.");
      }
      return models;
    }
    if (typeof nextRaw !== "string") {
      throw new Error("Codex model catalog discovery failed: malformed.");
    }
    if (seenCursors.has(nextRaw) || nextRaw === cursor) {
      throw new Error("Codex model catalog discovery failed: malformed.");
    }
    cursor = nextRaw;
  }
  throw new Error("Codex model catalog discovery failed: malformed.");
}

/** Clamp against model/list because, for example, some models use none instead of minimal. */
function supportedCodexEffort(
  effort: ReasoningEffort | undefined,
  modelLabel: string | undefined,
  modelList: JsonRecord | undefined,
) {
  const preferred = preferredCodexEffort(effort);
  if (!preferred) return undefined;
  const models = records(modelList?.data);
  const model =
    models.find(
      (candidate) =>
        stringValue(candidate.id) === modelLabel ||
        stringValue(candidate.model) === modelLabel,
    ) ?? models.find((candidate) => candidate.isDefault === true);
  if (!model) return preferred;
  const supported = records(model.supportedReasoningEfforts)
    .map((option) => stringValue(option.reasoningEffort))
    .filter((value): value is string => value !== undefined);
  if (supported.includes(preferred)) return preferred;

  const scale = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
  const target = scale.indexOf(preferred);
  const candidates = supported
    .map((value) => ({
      value,
      index: scale.indexOf(value as (typeof scale)[number]),
    }))
    .filter((candidate) => candidate.index >= 0)
    .sort((a, b) => {
      const distance = Math.abs(a.index - target) - Math.abs(b.index - target);
      if (distance !== 0) return distance;
      // "off" biases down to none; all other values bias toward more reasoning.
      return effort === "off" ? a.index - b.index : b.index - a.index;
    });
  return candidates[0]?.value ?? preferred;
}

function textInput(text: string) {
  return { type: "text", text, text_elements: [] };
}

/**
 * Parse a `thread/tokenUsage/updated` payload into context occupancy.
 * `tokenUsage.total` accumulates every request in the thread (cached prompt
 * tokens re-counted per request), so it is a cumulative spend counter — not
 * occupancy — and treating it as occupancy pinned the gauge at 100%.
 * `tokenUsage.last` is the most recent request, whose totalTokens is what
 * codex-rs itself uses as `tokens_in_context_window()`.
 */
export function parseThreadTokenUsage(params: unknown) {
  const usage = record(record(params)?.tokenUsage);
  const last = record(usage?.last);
  return {
    tokens: numberValue(last?.totalTokens),
    contextWindow: numberValue(usage?.modelContextWindow),
  };
}

// --- Item translation --------------------------------------------------------

function fileChangePreview(item: JsonRecord) {
  const paths = records(item.changes)
    .map((change) => stringValue(change.path))
    .filter((value): value is string => value !== undefined);
  return paths.length > 0
    ? paths.join(", ").slice(0, PREVIEW_MAX_LENGTH)
    : undefined;
}

function toolDescription(
  item: JsonRecord,
): { id: string; name: string; args?: string } | undefined {
  const id = stringValue(item.id);
  const type = stringValue(item.type);
  if (!id || !type) return undefined;
  switch (type) {
    case "commandExecution":
      return { id, name: "shell", args: firstLine(item.command) };
    case "fileChange":
      return { id, name: "apply_patch", args: fileChangePreview(item) };
    case "webSearch":
      return { id, name: "web_search", args: firstLine(item.query) };
    case "mcpToolCall": {
      const server = stringValue(item.server);
      const tool = stringValue(item.tool) ?? "tool";
      return {
        id,
        name: server ? `${server}/${tool}` : tool,
        args: safeJson(item.arguments),
      };
    }
    case "dynamicToolCall": {
      const namespace = stringValue(item.namespace);
      const tool = stringValue(item.tool) ?? "tool";
      return {
        id,
        name: namespace ? `${namespace}/${tool}` : tool,
        args: safeJson(item.arguments),
      };
    }
    default:
      return undefined;
  }
}

function toolOutput(item: JsonRecord, buffered: string) {
  switch (stringValue(item.type)) {
    case "commandExecution":
      return stringValue(item.aggregatedOutput) ?? buffered;
    case "fileChange":
      return fileChangePreview(item);
    case "webSearch":
      return stringValue(item.query);
    case "mcpToolCall":
      return safeJson(item.result ?? item.error);
    case "dynamicToolCall": {
      const text = records(item.contentItems)
        .map((content) => stringValue(content.text))
        .filter((value): value is string => value !== undefined)
        .join("\n");
      return text || safeJson(item.contentItems);
    }
    default:
      return buffered;
  }
}

function toolFailed(item: JsonRecord) {
  const status = stringValue(item.status);
  const exitCode = numberValue(item.exitCode);
  const success = booleanValue(item.success);
  return (
    (exitCode !== undefined && exitCode !== 0) ||
    success === false ||
    status === "failed" ||
    status === "declined" ||
    status === "cancelled"
  );
}

// --- The session -------------------------------------------------------------

const makeCodexSession = (
  task: SpawnTask,
): Effect.Effect<SubagentSession, SpawnError, Scope.Scope> =>
  Effect.gen(function* () {
    const binary = resolveCodexBinary();
    if (!binary) {
      return yield* new SpawnError({
        message: "codex executable was not found on PATH.",
      });
    }

    const events = yield* Queue.make<SubagentEvent, Cause.Done>();
    const emit = (event: SubagentEvent) => {
      Queue.offerUnsafe(events, event);
    };

    const child = yield* Effect.try({
      try: () =>
        spawn(binary, ["app-server", "--stdio"], {
          cwd: task.cwd,
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
          // Own process group on POSIX so teardown can signal the whole
          // tree: a wedged app-server must not orphan a still-running
          // shell command it spawned.
          detached: process.platform !== "win32",
        }),
      catch: (error) => new SpawnError({ message: boundedError(error) }),
    });

    const state = {
      closed: false,
      closing: false,
      exited: false,
      activeRun: false,
      dispatching: false,
      interruptRequested: false,
      effort: preferredCodexEffort(task.reasoningEffort),
      runSerial: 0,
      activeTurnId: undefined as string | undefined,
      runError: undefined as string | undefined,
      finalText: "",
      lastAssistantText: "",
      pendingPrompts: [] as string[],
      nextRequestId: 0,
      stderr: "",
      meta: {
        backend: "codex",
        modelLabel: task.model,
      } satisfies SubagentMeta as SubagentMeta,
      interruptTimer: undefined as ReturnType<typeof setTimeout> | undefined,
      settleWaiters: new Set<() => void>(),
    };
    const pendingRequests = new Map<number, PendingRequest>();
    const tools = new Map<string, ToolState>();
    /** Turns locally settled by the interrupt fallback may still emit late events. */
    const ignoredTurnIds = new Set<string>();

    const writeMessage = (message: JsonRecord) => {
      if (state.closed || !child.stdin.writable) return false;
      child.stdin.write(`${JSON.stringify(message)}\n`);
      return true;
    };

    const request = (
      method: string,
      params: JsonRecord,
      timeoutMs = REQUEST_TIMEOUT_MS,
    ) =>
      new Promise<JsonRecord>((resolve, reject) => {
        if (state.closed) {
          reject(new Error("Codex app-server is closed."));
          return;
        }
        const id = ++state.nextRequestId;
        const timer = setTimeout(() => {
          pendingRequests.delete(id);
          reject(new Error(`Codex app-server request ${method} timed out.`));
        }, timeoutMs);
        pendingRequests.set(id, { resolve, reject, timer });
        if (!writeMessage({ id, method, params })) {
          clearTimeout(timer);
          pendingRequests.delete(id);
          reject(new Error("Codex app-server stdin is closed."));
        }
      });

    const rejectPending = (message: string) => {
      for (const pending of pendingRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(message));
      }
      pendingRequests.clear();
    };

    const queuedView = () =>
      state.pendingPrompts.map((text) => ({
        text,
        kind: "follow-up" as const,
      }));

    const startNextQueued = () => {
      if (state.closed || state.activeRun) return;
      const next = state.pendingPrompts.shift();
      if (next === undefined) return;
      emit({ _tag: "QueueChanged", queued: queuedView() });
      startRun(next);
    };

    const settleRun = (outcome: RunOutcome, serial = state.runSerial) => {
      if (!state.activeRun || serial !== state.runSerial) return;
      if (state.interruptTimer) clearTimeout(state.interruptTimer);
      state.interruptTimer = undefined;
      state.activeRun = false;
      state.dispatching = false;
      // A late turn/completed for this turn must not be misattributed to the
      // next queued run (which starts with no activeTurnId to filter on).
      if (state.activeTurnId) ignoredTurnIds.add(state.activeTurnId);
      state.activeTurnId = undefined;
      state.interruptRequested = false;
      tools.clear();
      emit({ _tag: "RunSettled", outcome });
      for (const waiter of state.settleWaiters) waiter();
      state.settleWaiters.clear();
      queueMicrotask(startNextQueued);
    };

    const sendInterrupt = (serial: number) => {
      const turnId = state.activeTurnId;
      const threadId = state.meta.nativeSessionId;
      if (
        !turnId ||
        !threadId ||
        !state.activeRun ||
        serial !== state.runSerial
      )
        return;
      void request(
        "turn/interrupt",
        { threadId, turnId },
        INTERRUPT_FALLBACK_MS,
      ).catch((error) => {
        if (state.activeRun && serial === state.runSerial) {
          emit({ _tag: "BackendError", message: boundedError(error) });
        }
      });
    };

    function startRun(text: string) {
      if (state.closed || state.activeRun) return;
      const threadId = state.meta.nativeSessionId;
      if (!threadId) return;
      const serial = ++state.runSerial;
      state.activeRun = true;
      state.dispatching = true;
      state.interruptRequested = false;
      state.activeTurnId = undefined;
      state.runError = undefined;
      state.finalText = "";
      state.lastAssistantText = "";
      emit({ _tag: "UserMessage", text });
      emit({ _tag: "RunStarted" });

      const params: JsonRecord = {
        threadId,
        input: [textInput(text)],
        ...(state.effort ? { effort: state.effort } : {}),
      };
      void request("turn/start", params).then(
        (result) => {
          const turn = record(result.turn);
          const turnId = stringValue(turn?.id);
          if (!state.activeRun || serial !== state.runSerial) {
            if (turnId) {
              // The run was already settled locally (interrupt fallback or
              // failure), so whatever native turn this response describes is
              // invisible work — stop it unconditionally.
              ignoredTurnIds.add(turnId);
              void request(
                "turn/interrupt",
                { threadId, turnId },
                INTERRUPT_FALLBACK_MS,
              ).catch(() => undefined);
            }
            return;
          }
          state.dispatching = false;
          state.activeTurnId = turnId ?? state.activeTurnId;
          if (state.interruptRequested) sendInterrupt(serial);
        },
        (error) => {
          if (!state.activeRun || serial !== state.runSerial) return;
          const errorText = boundedError(error);
          settleRun(
            state.interruptRequested
              ? {
                  _tag: "Interrupted",
                  partialText: state.finalText || undefined,
                }
              : {
                  _tag: "Failed",
                  errorText,
                  partialText: state.finalText || undefined,
                },
            serial,
          );
          // A timed-out turn/start means a turn may be running that we can
          // never see or interrupt (no turn id). That session cannot be
          // trusted with further work — kill it; the exit handler reports
          // the death. Explicit protocol rejections keep the session alive.
          if (errorText.includes("timed out")) {
            void terminateChild(child, () => state.exited);
          }
        },
      );
    }

    const emitToolStart = (item: JsonRecord) => {
      const tool = toolDescription(item);
      if (!tool || tools.has(tool.id)) return;
      tools.set(tool.id, { name: tool.name, output: "" });
      const toolPart: TranscriptPart = {
        type: "toolCall",
        toolId: tool.id,
        name: tool.name,
        argsPreview: tool.args,
      };
      emit({ _tag: "AssistantMessage", parts: [toolPart] });
      emit({
        _tag: "ToolStart",
        toolId: tool.id,
        name: tool.name,
        argsPreview: tool.args,
      });
    };

    const emitToolEnd = (item: JsonRecord) => {
      const description = toolDescription(item);
      if (!description) return;
      if (!tools.has(description.id)) emitToolStart(item);
      const live = tools.get(description.id);
      const output = toolOutput(item, live?.output ?? "");
      tools.delete(description.id);
      emit({
        _tag: "ToolEnd",
        toolId: description.id,
        name: live?.name ?? description.name,
        isError: toolFailed(item),
        outputPreview: firstLine(output),
      });
    };

    const handleItemCompleted = (item: JsonRecord) => {
      const type = stringValue(item.type);
      if (type === "agentMessage") {
        const text = stringValue(item.text) ?? "";
        if (text) {
          emit({
            _tag: "AssistantMessage",
            parts: [{ type: "text", text }],
          });
          state.lastAssistantText = text;
          // The protocol permits unphased output from older models.
          if (item.phase == null || item.phase === "final_answer")
            state.finalText = text;
        }
        return;
      }
      if (type === "reasoning") {
        const thinking = [
          ...strings(item.summary),
          ...strings(item.content),
        ].join("\n");
        if (thinking) {
          emit({
            _tag: "AssistantMessage",
            parts: [{ type: "thinking", text: thinking }],
          });
        }
        return;
      }
      emitToolEnd(item);
    };

    const handleNotification = (message: JsonRecord) => {
      if (state.closed) return;
      const method = stringValue(message.method);
      const params = record(message.params) ?? {};
      const notificationTurn = record(params.turn);
      const turnId =
        stringValue(params.turnId) ?? stringValue(notificationTurn?.id);
      if (turnId && ignoredTurnIds.has(turnId)) return;
      const belongsToRun =
        method === "error" ||
        method?.startsWith("turn/") === true ||
        method?.startsWith("item/") === true ||
        method === "thread/tokenUsage/updated";
      if (belongsToRun && !state.activeRun) {
        if (turnId) ignoredTurnIds.add(turnId);
        return;
      }
      if (
        belongsToRun &&
        turnId &&
        state.activeTurnId &&
        turnId !== state.activeTurnId
      ) {
        return;
      }
      switch (method) {
        case "thread/started": {
          const thread = record(params.thread);
          const id = stringValue(thread?.id);
          const sessionFilePath = stringValue(thread?.path);
          if (id) state.meta = { ...state.meta, nativeSessionId: id };
          if (sessionFilePath) state.meta = { ...state.meta, sessionFilePath };
          emit({ _tag: "MetaChanged", meta: state.meta });
          break;
        }
        case "thread/settings/updated": {
          const settings = record(params.threadSettings);
          const modelLabel = stringValue(settings?.model);
          if (modelLabel) {
            state.meta = { ...state.meta, modelLabel };
            emit({ _tag: "MetaChanged", meta: { modelLabel } });
          }
          break;
        }
        case "model/rerouted": {
          const modelLabel = stringValue(params.toModel);
          const fromModel = stringValue(params.fromModel);
          if (modelLabel) {
            state.meta = { ...state.meta, modelLabel };
            emit({ _tag: "MetaChanged", meta: { modelLabel } });
          }
          if (fromModel && modelLabel && fromModel !== modelLabel) {
            state.runError = boundedError(
              `Codex substituted model "${modelLabel}" for "${fromModel}". Silent substitution is not allowed.`,
            );
            emit({ _tag: "BackendError", message: state.runError });
          }
          break;
        }
        case "turn/started": {
          const turn = record(params.turn);
          const startedId = stringValue(turn?.id);
          // Only adopt a turn we are actually waiting on. A stale start from
          // a run the interrupt fallback settled before its turn/start
          // response arrived would otherwise capture activeTurnId and filter
          // out every event of the real next turn.
          if (!state.dispatching && startedId !== state.activeTurnId) {
            if (startedId) ignoredTurnIds.add(startedId);
            break;
          }
          state.activeTurnId = startedId ?? state.activeTurnId;
          state.dispatching = false;
          emit({ _tag: "RunStarted" });
          if (state.interruptRequested) sendInterrupt(state.runSerial);
          break;
        }
        case "item/agentMessage/delta": {
          const delta = stringValue(params.delta);
          if (delta) emit({ _tag: "AssistantDelta", kind: "text", delta });
          break;
        }
        case "item/reasoning/summaryTextDelta":
        case "item/reasoning/textDelta": {
          const delta = stringValue(params.delta);
          if (delta)
            emit({
              _tag: "AssistantDelta",
              kind: "thinking",
              delta,
            });
          break;
        }
        case "item/started": {
          const item = record(params.item);
          if (item) emitToolStart(item);
          break;
        }
        case "item/completed": {
          const item = record(params.item);
          if (item) handleItemCompleted(item);
          break;
        }
        case "item/commandExecution/outputDelta":
        case "item/fileChange/outputDelta": {
          const id = stringValue(params.itemId);
          const delta = stringValue(params.delta);
          const tool = id ? tools.get(id) : undefined;
          if (id && tool && delta) {
            tool.output = `${tool.output}${delta}`.slice(-16_384);
            emit({
              _tag: "ToolUpdate",
              toolId: id,
              outputPreview: firstLine(tool.output),
            });
          }
          break;
        }
        case "item/fileChange/patchUpdated": {
          const id = stringValue(params.itemId);
          if (id) {
            emit({
              _tag: "ToolUpdate",
              toolId: id,
              outputPreview: fileChangePreview({
                changes: params.changes,
              }),
            });
          }
          break;
        }
        case "item/mcpToolCall/progress": {
          const id = stringValue(params.itemId);
          if (id) {
            emit({
              _tag: "ToolUpdate",
              toolId: id,
              outputPreview: firstLine(params.message),
            });
          }
          break;
        }
        case "thread/tokenUsage/updated": {
          const { tokens, contextWindow } = parseThreadTokenUsage(params);
          if (contextWindow !== undefined) {
            state.meta = { ...state.meta, contextWindow };
            emit({ _tag: "MetaChanged", meta: { contextWindow } });
          }
          emit({ _tag: "UsageChanged", tokens, contextWindow });
          break;
        }
        case "error": {
          const error = record(params.error);
          const messageText = boundedError(
            stringValue(error?.message) ?? "Codex run failed",
          );
          if (params.willRetry !== true) state.runError = messageText;
          emit({ _tag: "BackendError", message: messageText });
          break;
        }
        case "turn/completed": {
          const turn = record(params.turn);
          const status = stringValue(turn?.status);
          const error = record(turn?.error);
          const finalText = state.finalText.trim();
          const partialText =
            (finalText || state.lastAssistantText).trim() || undefined;
          if (state.interruptRequested || status === "interrupted") {
            settleRun({ _tag: "Interrupted", partialText });
          } else if (status === "failed") {
            settleRun({
              _tag: "Failed",
              errorText: boundedError(
                state.runError ??
                  stringValue(error?.message) ??
                  "Codex run failed",
              ),
              partialText,
            });
          } else if (
            status !== "completed" ||
            state.runError ||
            error ||
            !finalText
          ) {
            const reason =
              state.runError ??
              (error
                ? "Codex turn completed with an error payload"
                : status === "completed"
                  ? "Codex run completed without a final assistant message"
                  : `Codex turn ended with status ${status ?? "missing"}`);
            settleRun({
              _tag: "Failed",
              errorText: boundedError(reason),
              partialText,
            });
          } else {
            settleRun({
              _tag: "Completed",
              finalText,
            });
          }
          break;
        }
      }
    };

    const handleServerRequest = (message: JsonRecord) => {
      const id = message.id;
      if (typeof id !== "number" && typeof id !== "string") return;
      const method = stringValue(message.method);
      if (
        method === "item/commandExecution/requestApproval" ||
        method === "item/fileChange/requestApproval"
      ) {
        writeMessage({ id, result: { decision: "decline" } });
        return;
      }
      writeMessage({
        id,
        error: {
          code: -32601,
          message: `Unsupported headless server request: ${method ?? "unknown"}`,
        },
      });
    };

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        emit({
          _tag: "BackendError",
          message: `Invalid Codex protocol line: ${line.slice(0, 512)}`,
        });
        return;
      }
      const message = record(parsed);
      if (!message) return;
      const id = numberValue(message.id);
      if (id !== undefined && pendingRequests.has(id)) {
        const pending = pendingRequests.get(id);
        if (!pending) return;
        pendingRequests.delete(id);
        clearTimeout(pending.timer);
        if (message.error !== undefined) {
          const rpcError = new Error(protocolError(message.error));
          const code = numberValue(record(message.error)?.code);
          if (code !== undefined) {
            (rpcError as { jsonRpcCode?: number }).jsonRpcCode = code;
          }
          pending.reject(rpcError);
        } else pending.resolve(record(message.result) ?? {});
        return;
      }
      if (message.id !== undefined && message.method !== undefined)
        handleServerRequest(message);
      else if (message.method !== undefined) handleNotification(message);
    };

    const failForProcessExit = (detail: string) => {
      if (state.exited) return;
      state.exited = true;
      rejectPending(detail);
      if (state.closing) return;
      state.closed = true;
      state.pendingPrompts = [];
      emit({ _tag: "QueueChanged", queued: [] });
      if (state.activeRun) {
        settleRun({
          _tag: "Failed",
          errorText: boundedError(detail),
          partialText: state.finalText || state.lastAssistantText || undefined,
        });
      }
      Queue.endUnsafe(events);
    };

    let stdoutBuffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      while (true) {
        const newline = stdoutBuffer.indexOf("\n");
        if (newline < 0) break;
        const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        handleLine(line);
      }
      if (stdoutBuffer.length > STDOUT_BUFFER_MAX_BYTES) {
        // A frame this large with no newline is protocol corruption, and an
        // unbounded buffer is a memory leak. Session-fatal: the exit handler
        // settles any active run.
        stdoutBuffer = "";
        void terminateChild(child, () => state.exited);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      state.stderr = `${state.stderr}${chunk}`.slice(-4096);
    });
    child.once("error", (error) =>
      failForProcessExit(`Codex app-server failed: ${boundedError(error)}`),
    );
    child.once("exit", (code, signal) => {
      const suffix = firstLine(state.stderr);
      failForProcessExit(
        `Codex app-server exited (${signal ?? `code ${code ?? "unknown"}`})${suffix ? `: ${suffix}` : ""}`,
      );
    });

    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        if (state.closing) return;
        state.closing = true;
        if (state.interruptTimer) clearTimeout(state.interruptTimer);
        // Settle before marking closed so the run gets the correct
        // "Interrupted" outcome instead of the pump's generic fallback.
        if (state.activeRun) {
          settleRun({
            _tag: "Interrupted",
            partialText:
              state.finalText || state.lastAssistantText || undefined,
          });
        }
        state.closed = true;
        rejectPending("Codex session closed.");
        await terminateChild(child, () => state.exited);
        Queue.endUnsafe(events);
      }),
    );

    const threadResult = yield* Effect.tryPromise({
      try: async () => {
        await request("initialize", {
          clientInfo: {
            name: "pi-subagents",
            title: "pi subagent",
            version: "2.0.0",
          },
          capabilities: { experimentalApi: true },
        });
        writeMessage({ method: "initialized" });

        let accountResult: JsonRecord;
        try {
          accountResult = await request(
            "account/read",
            {},
            MODEL_LIST_TIMEOUT_MS,
          );
        } catch (error) {
          throw classifiedDiscoveryFailure("account", error);
        }
        if (!accountIsUsable(accountResult)) {
          throw new Error(
            "Codex app-server has no usable Codex account. ChatGPT OAuth or an OpenAI API key is required for OpenAI-hosted models. Run codex login for this configuration home or configure the intended provider; Pi OAuth credentials do not authenticate Codex CLI.",
          );
        }

        const catalog = await listCodexCatalog(request);
        if (task.model && !catalogEntry(catalog, task.model)) {
          const alternatives = catalogModelIds(catalog)
            .filter((id) => id !== task.model)
            .slice(0, 8);
          throw new Error(
            `Unsupported Codex model "${task.model}". Verified catalog alternatives: ${alternatives.join(", ")}. Catalog membership does not guarantee entitlement.`,
          );
        }

        // Headless children cannot answer approval prompts. The caller
        // already chose to launch an autonomous subagent, so give the thread
        // full workspace access without interactive approval requests.
        const started = await request("thread/start", {
          cwd: task.cwd,
          approvalPolicy: "never",
          sandbox: "danger-full-access",
          ephemeral: false,
          ...(task.model
            ? { model: task.model, allowProviderModelFallback: false }
            : {}),
        });
        const returnedModel = stringValue(started.model)?.trim();
        if (!returnedModel) {
          throw new Error(
            "Codex thread/start returned no model. The selected model cannot be verified.",
          );
        }
        if (task.model) {
          if (!sameCatalogSelection(task.model, returnedModel, catalog)) {
            throw new Error(
              `Codex substituted model "${returnedModel}" for requested "${task.model}". Silent substitution is not allowed.`,
            );
          }
        } else if (!catalogEntry(catalog, returnedModel)) {
          throw new Error(
            `Codex started model "${returnedModel}" is not in the verified catalog. Silent substitution is not allowed.`,
          );
        }
        if (task.reasoningEffort) {
          state.effort = supportedCodexEffort(
            task.reasoningEffort,
            returnedModel,
            { data: catalog },
          );
        }
        return started;
      },
      catch: (error) => new SpawnError({ message: boundedError(error) }),
    });

    const thread = record(threadResult.thread);
    const nativeSessionId = stringValue(thread?.id);
    if (!nativeSessionId) {
      return yield* new SpawnError({
        message: "Codex thread/start returned no thread id.",
      });
    }
    state.meta = {
      backend: "codex",
      modelLabel: stringValue(threadResult.model) ?? task.model,
      sessionFilePath: stringValue(thread?.path),
      nativeSessionId,
    };
    emit({ _tag: "MetaChanged", meta: state.meta });
    startRun(task.prompt);

    return {
      meta: Effect.sync(() => state.meta),
      events: Stream.fromQueue(events),
      send: (text) =>
        Effect.suspend(() => {
          if (state.closed) {
            return new SendError({
              message: "Subagent session is closed.",
            });
          }
          if (state.activeRun) {
            state.pendingPrompts.push(text);
            emit({ _tag: "QueueChanged", queued: queuedView() });
            return Effect.succeed("queued" as const);
          }
          return Effect.sync(() => {
            startRun(text);
            return "started" as const;
          });
        }),
      synchronize: Effect.callback<boolean>((resume) => {
        const accepted = Queue.offerUnsafe(events, {
          _tag: "Synchronized",
          resume: () => resume(Effect.succeed(true)),
        });
        if (!accepted) resume(Effect.succeed(false));
      }),
      interrupt: Effect.promise(async () => {
        if (state.closed) return;
        state.pendingPrompts = [];
        emit({ _tag: "QueueChanged", queued: [] });
        if (!state.activeRun) return;
        const serial = state.runSerial;
        state.interruptRequested = true;
        sendInterrupt(serial);
        if (state.interruptTimer) clearTimeout(state.interruptTimer);
        state.interruptTimer = setTimeout(() => {
          if (state.activeRun && serial === state.runSerial) {
            if (state.activeTurnId) ignoredTurnIds.add(state.activeTurnId);
            settleRun({
              _tag: "Interrupted",
              partialText:
                state.finalText || state.lastAssistantText || undefined,
            });
            // The server never acknowledged the interrupt, so the native
            // turn may still be executing tools. A session that ignores
            // interrupts cannot be trusted — kill it rather than let
            // invisible work continue behind a "settled" run.
            void terminateChild(child, () => state.exited);
          }
        }, INTERRUPT_FALLBACK_MS);
        if (state.activeRun && serial === state.runSerial) {
          await new Promise<void>((resolve) => {
            const waiter = () => resolve();
            state.settleWaiters.add(waiter);
            if (!state.activeRun || serial !== state.runSerial) {
              state.settleWaiters.delete(waiter);
              resolve();
            }
          });
        }
      }),
    } satisfies SubagentSession;
  });

/** Signal the whole process group on POSIX so tool descendants (shell
 * commands the app-server spawned) die with it; a wedged or force-killed
 * server must not orphan a still-running command in the workspace. */
function killTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
) {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Group may already be gone; fall through to the direct signal.
    }
  }
  child.kill(signal);
}

/** SIGTERM is normally enough; the second deadline covers a wedged Rust process. */
function terminateChild(
  child: ChildProcessWithoutNullStreams,
  exited: () => boolean,
) {
  if (exited()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let lastTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      if (forceTimer) clearTimeout(forceTimer);
      if (lastTimer) clearTimeout(lastTimer);
      resolve();
    };
    child.once("exit", finish);
    killTree(child, "SIGTERM");
    forceTimer = setTimeout(() => {
      if (!exited()) killTree(child, "SIGKILL");
    }, FORCE_KILL_AFTER_MS);
    lastTimer = setTimeout(finish, FORCE_KILL_AFTER_MS + 500);
  });
}

export const codexBackend: SubagentBackend = {
  name: "codex",
  capabilities: {
    steering: false,
    modelSelection: true,
    reasoningEffort: true,
  },
  available: Effect.sync(() => resolveCodexBinary() !== undefined),
  spawn: makeCodexSession,
};
