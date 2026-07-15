/** All model-facing strings for the subagents tools. */

/** Describes subagent_spawn, including harnesses and the fixed concurrency cap. */
export const SUBAGENT_SPAWN_TOOL_DESCRIPTION =
  "Spawn a persistent background subagent with its own context window. Choose pi (default in-process Pi session), Claude Code, or Codex CLI. Pi children use a durable role profile; omit role to use worker. Fire-and-forget: this returns immediately with an id. Results arrive automatically or through subagent_wait. Children cannot orchestrate more agents/workflows or ask the user, and cannot see this conversation, so the prompt must be self-contained. Max 8 subagents can run at once.";

/** Adds background subagent delegation to the parent model's available-tools prompt. */
export const SUBAGENT_SPAWN_PROMPT_SNIPPET =
  "Spawn a background subagent on a chosen harness (pi, Claude Code, or Codex; own context, normal tools) for a self-contained task";

/** Guides the parent model to delegate standalone tasks and avoid unnecessary blocking waits. */
export const SUBAGENT_SPAWN_PROMPT_GUIDELINES = [
  "Use subagent_spawn to delegate self-contained tasks that can run in the background; give it a complete, standalone prompt.",
  "For pi children, select the narrowest role that fits: explorer/reviewer for read-only work, editor for localized edits, worker for implementation, monitor for long commands.",
  "Pick the subagent harness deliberately: pi unless you have a reason to prefer Claude Code or Codex (e.g. the user asked for one, or the task suits that harness).",
  "After subagent_spawn, keep working; results arrive automatically. Only call subagent_wait when you cannot proceed without the result.",
];

/** Model-facing schema descriptions for subagent_spawn task and execution options. */
export const SUBAGENT_SPAWN_PARAMETER_DESCRIPTIONS = {
  prompt:
    "Task prompt for the subagent. Must be self-contained: include all needed context, file paths, and what to report back.",
  name: "Short human-readable name for this subagent, shown in listings and the UI",
  role: 'Pi role profile from bundled defaults or ~/.pi/agent/agents/*.toml overrides. Defaults to "worker" for pi. Roles are not applied to Claude/Codex backends.',
  harness:
    'Harness to run the subagent on: "pi" (in-process pi session; inherits this environment), "claude" (Claude Code), or "codex" (Codex CLI). Choose deliberately per task.',
  workingDir:
    "Initial working directory (default: current working directory). Pi role profiles restrict this initial cwd, not absolute paths used by later tools.",
  model:
    'Model hint, interpreted by the chosen harness (pi: "provider/model-id" or model id; claude: model alias like "sonnet"/"opus"; codex: model slug). Omit for the harness default (pi inherits the current model).',
  reasoningEffort:
    "Reasoning effort on a shared scale; the harness maps it to its nearest native equivalent (pi thinking level, codex reasoning effort, claude thinking budget). Omit for the harness default (pi inherits the current level).",
};

/** Builds the subagent_spawn result that tells the parent model how to continue or inspect the child. */
export function buildSubagentSpawnResult(options: {
  id: string;
  title: string;
  harness: string;
  modelLabel: string;
  cwd: string;
  role?: string;
}) {
  const role = options.role ? `, role: ${options.role}` : "";
  return (
    `Spawned subagent ${options.id} "${options.title}" (${options.harness}: ${options.modelLabel}${role}, ${options.cwd}).\n` +
    `It runs in the background. Its result will be delivered to you when it finishes, ` +
    `or use subagent_wait(ids: ["${options.id}"]) to block for it, subagent_send to steer it, subagent_cancel/subagent_interrupt to stop its active turn, subagent_close to release it, and subagent_check/subagent_list to inspect it.`
  );
}

/** Describes explicit blocking collection of one or more subagent results. */
export const SUBAGENT_WAIT_TOOL_DESCRIPTION =
  "Block until all listed subagents have settled, then return their final outputs. Prefer letting results arrive automatically; use this only when you need a result before continuing.";

/** Model-facing schema description for the subagent ids to await. */
export const SUBAGENT_WAIT_PARAMETER_DESCRIPTIONS = {
  ids: 'Subagent ids to wait for, e.g. ["sa-1", "sa-2"]',
};

/** Describes aborting running subagents while retaining their partial transcripts. */
export const SUBAGENT_CANCEL_TOOL_DESCRIPTION =
  "Interrupt one or more running subagents. This aborts active work but preserves each persistent session so it can receive a later subagent_send.";

/** Model-facing schema description for the subagent ids to cancel. */
export const SUBAGENT_CANCEL_PARAMETER_DESCRIPTIONS = {
  ids: 'Subagent ids to cancel, e.g. ["sa-1", "sa-2"]',
};

/** Describes nonblocking inspection of a subagent without consuming its result. */
export const SUBAGENT_CHECK_TOOL_DESCRIPTION =
  "Peek at a subagent's status and recent activity without blocking. Does not consume its result.";

/** Model-facing schema description for the subagent id to inspect. */
export const SUBAGENT_CHECK_PARAMETER_DESCRIPTIONS = {
  id: "Subagent id",
};

/** Describes listing all tracked running and settled subagents. */
export const SUBAGENT_LIST_TOOL_DESCRIPTION =
  "List all subagents (running and finished) with their harness and status.";

export const SUBAGENT_SEND_TOOL_DESCRIPTION =
  "Send a message to a persistent subagent. This steers its active turn, or starts a new turn in the same session when it is idle.";

export const SUBAGENT_SEND_PARAMETER_DESCRIPTIONS = {
  id: "Subagent id",
  message:
    "Self-contained follow-up instruction or correction for the subagent",
};

export const SUBAGENT_CLOSE_TOOL_DESCRIPTION =
  "Permanently close a subagent session and release its resources. Running work is interrupted first. The id cannot be reused afterward.";

export const SUBAGENT_CLOSE_PARAMETER_DESCRIPTIONS = {
  id: "Subagent id to close",
};

/** Builds the child completion/failure wrapper injected into the parent model's context. */
export function buildSubagentResultMessage(options: {
  id: string;
  title: string;
  status: "running" | "done" | "error";
  errorText?: string;
  output: string;
}) {
  const verb = options.status === "error" ? "failed" : "finished";
  let text = `Subagent ${options.id} "${options.title}" ${verb}.`;
  if (options.errorText) text += `\nError: ${options.errorText}`;
  text += `\n\n${options.output}`;
  return text;
}
