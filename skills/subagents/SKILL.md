---
name: subagents
description: Delegate and manage background work with persistent Pi, Claude Code, or Codex subagents. Use when the user asks for subagents, parallel agent work, delegation, background research, independent review, or a child agent with a separate context window.
---

# Subagents

Each subagent is headless, has its own context window, cannot see the parent conversation, cannot ask the user, and cannot spawn subagents or workflows. Give every child a self-contained prompt with paths, constraints, and the expected report.

Keep synthesis and final decisions in the parent. Spawn independent work early,
continue useful parent work, and wait only when the next step depends on the
child. Give concurrent writers non-overlapping ownership or separate worktrees.

## Pi Harness

**Harness:** `pi`
**Prompt nicknames:** “pi”, “pi agent”, “pi subagent”
**Best default:** Use when the user does not request another harness. It inherits the parent model and thinking level when `model` or `reasoning_effort` is omitted.

Do not use models from the Anthropic provider even if one appears in the model list.

Pi can use any model shown by `pi --list-models`. Prefer `provider/model-id`; a bare model id only works when unambiguous. Common picks in this environment:

| Model                            | Recommended effort |
| -------------------------------- | ------------------ |
| inherited parent model (default) | inherited          |
| `openai-codex/gpt-5.6-sol`       | `high`             |
| `openai-codex/gpt-5.6-terra`     | `high`             |
| `opencode/claude-fable-5`        | `medium`           |

**Thinking budgets:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. These map directly to pi thinking levels.

### Pi roles

Select the narrowest role that fits. Omit `role` to use `worker`.

- `explorer`: locate files, symbols, and evidence with read-only tools.
- `reviewer`: independently review risks and missing tests with read-only tools.
- `editor`: apply a small, already-decided edit without shell access.
- `worker`: implement a bounded task with normal coding tools.
- `monitor`: run or watch a command and report status without editing.

Role profiles live in `agents/*.toml`. They add durable system instructions and
an exact tool allowlist. They apply only to the Pi harness. By default, a role
cannot set `working_dir` outside the parent's current directory.

## Claude Code Harness

**Harness:** `claude`
**Prompt nicknames:** “claude”, “Claude Code”, “claude agent”, “claude subagent”, "cc"
**Best default:** use the latest fable model on high reasoning. Do not default to anything else, if the user does not specify, use fable.

| Model hint | Model               | Recommended effort |
| ---------- | ------------------- | ------------------ |
| `fable`    | latest Claude Fable | `high`             |

**Thinking budgets:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. The extension maps these to Claude thinking-token budgets: 0, 1,024, 4,096, 10,000, 16,000, 32,000, and 63,999 tokens respectively.

Requires Claude Code to be installed and authenticated.

## Codex Harness

**Harness:** `codex`
**Prompt nicknames:** “codex”, “Codex CLI”, “codex agent”, “codex subagent”
**Best default:** `gpt-5.6-sol` with `high` effort for coding work. Do not use anything other than sol unless the user specifically asks for it.

| Model           | Recommended effort |
| --------------- | ------------------ |
| `gpt-5.6-sol`   | `high`             |
| `gpt-5.6-terra` | `high`             |
| `gpt-5.6-luna`  | `high`             |

**Thinking budgets accepted by the extension:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Codex maps these to the nearest effort supported by the selected model; `off`/`minimal` become `minimal`, while `max` becomes the highest extension-supported Codex effort.

Requires the Codex CLI to be installed and authenticated.

## Spawn and Manage

Call `subagent_spawn` with a complete `prompt`, short `name`, chosen `harness`, and optional `role`, `working_dir`, `model`, and `reasoning_effort`. At most four subagents run concurrently.

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
