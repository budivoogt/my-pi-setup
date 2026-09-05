---
name: subagents
description: Delegate and manage background work with Pi, Claude Code, or Codex subagents. Use when the user asks for subagents, parallel agent work, delegation, background research, independent review, or a child agent with a separate context window.
---

# Subagents

Each subagent is headless, has its own context window, cannot see the parent conversation, cannot ask the user, and cannot spawn subagents or workflows. Give every child a self-contained prompt with paths, constraints, and the expected report.

Keep synthesis and final decisions in the parent. Spawn independent work early,
continue useful parent work, and wait only when the next step depends on the
child. Give concurrent writers non-overlapping ownership or separate worktrees.

## Pi Harness

**Harness:** `pi`
**Prompt nicknames:** “pi”, “pi agent”, “pi subagent”
**Best default:** Use when the user does not request another harness. Resolve model and provider in this order: explicit model, role profile, then inherited parent selection. Preserve explicit provider-qualified selections exactly.

Use `pi --list-models` to discover provider/model pairs, then check the active
parent registry and provider authentication metadata. The catalog alone is not
proof of configured authentication or server entitlement. `openai` uses the
OpenAI API route; `openai-codex` uses Pi's Codex OAuth route. Codex CLI login is
separate. Inspect configured-status metadata only, never credentials or resolved
request headers. Do not use models from the Anthropic provider in Pi.

Prefer `provider/model-id`. A bare ID first matches the inherited provider; only
without that match must it be globally unambiguous. If the selected model or
inherited model is missing, stop and use the preflight diagnostic. Do not choose
an unrelated default. Preserve explicit user choices; ask before changing the
model, provider, or account. Check role defaults against discovery rather than
retrying guessed model names.

**Thinking budgets:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. These map directly to pi thinking levels.

### Roles

Select the narrowest role that fits. Omit `role` to use `worker`.

- `explorer`: locate files, symbols, and evidence with read-only tools.
- `luna-explorer`: handle bounded secondary research with read-only tools.
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

Resolve each role from the live applicable catalog and role profile. Apply the
precedence above, then verify that the selected provider and profile are
supported and authenticated. Keep role effort semantics and the existing Fast
behavior: Fast maps to `priority` only when the effective Pi request provider is
`openai-codex`; non-OpenAI model overrides ignore it.

Keep `editor` for small, already-decided, low-risk, mechanically verifiable
edits. Use a strong `worker` for real implementation. Resolve authoritative
reviewers from the current reviewer role profiles and applicable catalog.
Grok runs on Pi, but is not an authoritative reviewer. Keep Grok worker/editor
effort above `off`.

### Explicit rescue/red-team perspectives

Red-team is an escalation, not ordinary delegation. It must be independent,
read-only, adversarial, and evidence-focused; it must not implement changes or
replace parent synthesis or `autoreview` PR closeout.

Prefer a top-model panel when red-team is warranted (explicit request, contested
high-risk work, or weak/uncertain review), ideally in parallel. Resolve each
seat from the live accepted reviewer profiles for its native harness. Label
outputs as additional perspectives. Do not infer a full panel from a generic
request for review. Keep red-team children read-only and reviewer-scoped; Grok
is not an authoritative reviewer.

## Claude Code Harness

**Harness:** `claude`
**Prompt nicknames:** “claude”, “Claude Code”, “claude agent”, “claude subagent”, "cc"
**Best default:** choose a role and resolve its accepted model ID from the
backend allowlist and active role profile. Preserve the role effort semantics.
Do not rely on a stale model table or aliases. Sonnet, Opus, and Fable use
adaptive thinking with the SDK's native effort level. Haiku uses fixed thinking
budgets only when reasoning is explicitly enabled.

Use the strong worker model and effort in the current Claude role profile.
Keep light models for explorer/editor roles, not as default implementation workers.
The allowlist lives in `../../extensions/subagents/src/backends/claude.ts` (`ALLOWED_CLAUDE_MODELS`);
role defaults live in `../../extensions/subagents/agents/` and local role overrides.

Requires Claude Code to be installed and authenticated. It uses the existing
Claude Code login and does not require changes to Claude's configuration.

## Codex Harness

**Harness:** `codex`
**Prompt nicknames:** “codex”, “Codex CLI”, “codex agent”, “codex subagent”
**Best default for strong coding/review:** use a capable model from the selected
Codex configuration home's app-server catalog. The adapter checks `account/read`
and bounded, paginated `model/list` before task execution. Use that catalog,
not the Pi registry, to select Codex slugs. Configured authentication and catalog
membership do not prove server entitlement. Report unavailable discovery,
authentication, or selection separately; use catalog-derived alternatives only
with the required capability and user approval for changes to explicit choices.

Codex does not apply Pi role profiles or accept the `role` parameter. Put role
instructions in the prompt. Omitted models use the Codex configuration default,
which the adapter validates before starting the turn.

**Thinking budgets accepted by the extension:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Codex maps these to the nearest effort supported by the selected model; `off`/`minimal` become `minimal`, while `max` becomes the highest extension-supported Codex effort.

Requires the Codex CLI to be installed and authenticated.

## Spawn and Manage

Call `subagent_spawn` with a complete `prompt`, short `name`, chosen `harness`, and optional `role`, `working_dir`, `model`, `reasoning_effort`, and
`persistent`. At most eight subagents run concurrently. Pi children are disposable by default. Set `persistent: true` only when a Pi child must accept another turn or support takeover after it settles. Claude and Codex keep persistent sessions. Spawn acceptance is not completion. Count a review as complete only after successful settlement with substantive output; failures, empty output, or interruption provide no signoff.

- `subagent_check({ id })`: peek without blocking.
- `subagent_list()`: list all runs.
- `subagent_wait({ ids })`: block only when results are required to proceed.
- `subagent_send({ id, message })`: steer a running child or start another turn in the same idle session.
- `subagent_interrupt({ id })`: abort the active turn. Persistent sessions remain available; disposable Pi sessions release after settlement.
- `subagent_cancel({ ids })`: compatibility form for interrupting several children.
- `subagent_close({ id })`: permanently dispose and remove a child.
- `/subagents`: inspect or take over a run interactively.

Results return automatically and explicit waits suppress duplicate delivery.
Keep high-churn retrieval and research Pi workers disposable. Close persistent
children when their context is no longer useful.
