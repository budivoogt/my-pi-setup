---
name: subagents
description: Delegate and manage background work with persistent Pi, Claude Code, or Codex subagents. Use when the user asks for subagents, parallel agent work, delegation, background research, independent review, or a child agent with a separate context window.
---

# Subagents

Each subagent is headless, has its own context window, cannot see the parent conversation, cannot ask the user, and cannot spawn subagents or workflows. Give every child a self-contained prompt with paths, constraints, and the expected report.

Keep synthesis and final decisions in the parent. Spawn independent work early,
continue useful parent work, and wait only when the next step depends on the
child. Give concurrent writers non-overlapping ownership or separate worktrees.
Anthropic-family children require an Anthropic-family primary orchestration
model; the extension rejects cross-provider Anthropic child requests.

## Pi Harness

**Harness:** `pi`
**Prompt nicknames:** “pi”, “pi agent”, “pi subagent”
**Best default:** Use when the user does not request another harness. It inherits the parent model and thinking level when `model` or `reasoning_effort` is omitted.

Do not use models from the Anthropic provider even if one appears in the model list.

Pi can use any model shown by `pi --list-models`. Prefer `provider/model-id`; a bare model id only works when unambiguous. Common picks in this environment:

| Model                            | Recommended effort                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| inherited parent model (default) | inherited                                                                                                      |
| `openai-codex/gpt-5.6-sol`       | `high`                                                                                                         |
| `openai-codex/gpt-5.6-terra`     | `high`                                                                                                         |
| `xai/grok-4.5`                   | `low` for editor, `high` for default worker; also used at `high` in red-team panels (role distinguishes intent) |

**Thinking budgets:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. These map directly to pi thinking levels.

### Roles

Select the narrowest role that fits. Omit `role` to use `worker`.

- `explorer`: locate files, symbols, and evidence with read-only tools.
- `reviewer`: independently review risks and missing tests with read-only tools.
- `editor`: apply a small, already-decided edit without shell access.
- `worker`: implement a bounded task with normal coding tools.
- `monitor`: run or watch a command and report status without editing.

Default role profiles are bundled with the extension. Files in
`~/.pi/agent/agents/*.toml` override them by role name. Roles add durable system
instructions and an exact tool allowlist. They apply to Pi and Claude harnesses.
By default, a role cannot set `working_dir` outside the parent's current
directory.

### Pi model routing

- `editor` defaults to `xai/grok-4.5`/`low`. Keep its work small,
  already-decided, low-risk, and mechanically verifiable. If the edit is not
  already decided, use `worker` instead of raising editor effort.
- `worker` defaults to `xai/grok-4.5`/`high` (strong default). Codex-native
  strong coding still uses Terra/Sol on the Codex harness; Claude-native strong
  coding uses Opus on the Claude harness.
- Do not use Grok with `off` for worker/editor tasks, and do not use Grok as the
  authoritative `reviewer`. Use Sol for Pi reviewers and Opus 5 for Claude-native reviewers.
- Grok always runs on the Pi harness. Do not expect Codex CLI native agents to
  host Grok.

### Explicit rescue/red-team perspectives

Red-team is an escalation, not ordinary delegation. It must be independent,
read-only, adversarial, and evidence-focused; it must not implement changes or
replace parent synthesis or `autoreview` PR closeout.

Prefer a top-model panel when red-team is warranted (explicit request, contested
high-risk work, or weak/uncertain review), ideally in parallel:
- `openai-codex/gpt-5.6-sol` / `xhigh`
- `xai/grok-4.5` / `high` on Pi
- Claude `claude-opus-5` / `high` only when the parent is Anthropic-family

Label outputs as additional perspectives. Do not infer a full panel from a
generic request for review. Grok `high` is allowed for the normal Pi `worker`
role; for red-team keep the child on a read-only reviewer-style brief.

## Claude Code Harness

**Harness:** `claude`
**Prompt nicknames:** “claude”, “Claude Code”, “claude agent”, “claude subagent”, "cc"
**Best default:** choose a role and use its pinned model and effort. Omit the role
only when there is a specific reason to override the mapping.

| Role       | Exact model ID     | Effort   |
| ---------- | ------------------ | -------- |
| `monitor`  | `claude-haiku-4-5` | `off`    |
| `explorer` | `claude-sonnet-5`  | `low`    |
| `editor`   | `claude-sonnet-5`  | `medium` |
| `worker`   | `claude-opus-5`    | `high`   |
| `reviewer` | `claude-opus-5`    | `high`   |

Only approved exact Claude model IDs are accepted. Do not use aliases such as
`haiku` or `sonnet`; local Claude settings can redirect aliases. Fable 5 remains
available only when the user explicitly selects `claude-fable-5`. Sonnet, Opus,
and Fable use adaptive thinking with the SDK's native effort level. Haiku uses
fixed thinking budgets only when reasoning is explicitly enabled.

Claude worker and reviewer default to Opus 5/high. Use Sonnet only for explorer/editor
roles, not as the default implementation worker.

Requires Claude Code to be installed and authenticated. It uses the existing
Claude Code login and does not require changes to Claude's configuration.

## Codex Harness

**Harness:** `codex`
**Prompt nicknames:** “codex”, “Codex CLI”, “codex agent”, “codex subagent”
**Best default for strong coding/review:** `gpt-5.6-sol` with `high`/`xhigh`.
Use native OpenAI models on the Codex harness. For Grok, spawn a Pi child
instead of pretending Codex hosts xAI.

| Model                 | Recommended effort | Typical role |
| --------------------- | ------------------ | ------------ |
| `gpt-5.3-codex-spark` | `high`             | explorer     |
| `gpt-5.6-luna`        | `low`/`medium`     | monitor/editor |
| `gpt-5.6-terra`       | `high`             | Codex-native / Pi-alternative strong worker |
| `gpt-5.6-sol`         | `high`/`xhigh`     | reviewer / parent judgment |

**Thinking budgets accepted by the extension:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Codex maps these to the nearest effort supported by the selected model; `off`/`minimal` become `minimal`, while `max` becomes the highest extension-supported Codex effort.

Requires the Codex CLI to be installed and authenticated.

## Spawn and Manage

Call `subagent_spawn` with a complete `prompt`, short `name`, chosen `harness`, and optional `role`, `working_dir`, `model`, and `reasoning_effort`. At most eight subagents run concurrently.

- `subagent_check({ id })`: peek without blocking.
- `subagent_list()`: list all runs.
- `subagent_wait({ ids })`: block only when results are required to proceed.
- `subagent_send({ id, message })`: steer a running child or start another turn in the same idle session.
- `subagent_interrupt({ id })`: abort the active turn but keep the persistent session.
- `subagent_cancel({ ids })`: compatibility form for interrupting several children.
- `subagent_close({ id })`: permanently dispose and remove a child.
- `/subagents`: inspect or take over a run interactively.

Results return automatically and explicit waits suppress duplicate delivery.
Close idle children when their persistent context is no longer useful.
