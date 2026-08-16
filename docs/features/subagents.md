---
summary: "Persistent role-driven subagent architecture"
read_when: "changing subagent tools, roles, lifecycle, or backends"
owner: "@budivoogt"
---

# Persistent subagents

## User-visible behavior

The extension registers a persistent child-agent lifecycle: spawn, send, wait,
interrupt, close, check, and list. Spawn is asynchronous. The manager folds each
backend's event stream into a stable snapshot used by model-facing tools and the
`/subagents` dashboard. A child can receive multiple turns without losing its
context.

Results that finish while the parent is busy are queued and delivered when the
parent becomes idle. An explicit wait marks its selected results as consumed,
preventing duplicate automatic delivery.

The `/subagents` takeover view hides child reasoning by default and keeps tool
results to one-line previews. `Ctrl+T` toggles reasoning visibility without
changing the child's configured effort or model.

## Architecture

`extensions/subagents/src/backend.ts` defines the common persistent-session
contract. Pi runs an in-process `AgentSession`; Claude uses its Agent SDK; Codex
uses `codex app-server`. `extensions/subagents/src/manager.ts` owns the registry,
race-safe eight-agent reservation, event folding, wait interest, pruning, bounded
interrupt, and scope cleanup. `extensions/subagents/index.ts` is the Pi extension
boundary and tool/UI layer.

Interrupt stops only the active turn. Close interrupts if necessary, waits for
the manager to fold a terminal event, closes the backend scope, and removes the
id. This ordering avoids reporting a closed child as still running.

## Roles

Role defaults are bundled under `extensions/subagents/agents/`. User TOML
files under `~/.pi/agent/agents/` override bundled profiles by role name. Each
profile requires `name`, `description`, `developer_instructions`, and a
non-empty `tools` array. Optional fields are `model`, `reasoning_effort`,
Pi-only `service_tier`, `claude_model`, `claude_reasoning_effort`, and
`allow_outside_parent_cwd`. The only service-tier contract is `fast`, which Pi
maps to `priority` only when the effective request provider is `openai-codex`.

The tool layer resolves roles for Pi and Claude before spawn. User-supplied
model and effort values override the selected harness defaults. For Pi, role
instructions extend the child system prompt and role tools are passed to
`createAgentSession`. For Claude, the same instructions extend the Claude Code
preset and Pi tool names are mapped to a strict Claude built-in allowlist.
Backend denylists remove child orchestration and user-question tools.

Bundled models fail fast when a configured provider/model is unavailable. Pi
uses Luna/high/Fast for explorer, Luna/medium/Fast for luna-explorer,
Luna/low/Fast for monitor, Grok 4.6/low for editor, Grok 4.6/medium for worker,
and Sol/xhigh for reviewer. Fast is applied only by the Pi backend, where it
becomes the provider request's `serviceTier: "priority"`; non-OpenAI Pi model
overrides ignore it, and Claude and Codex do not receive it. Low effort is a scope-appropriate editor default for small,
already-decided, mechanically verifiable changes; non-trivial implementation
should use `worker` rather than raising editor effort. Worker is strong by
default. Grok is not the authoritative reviewer. The eight-agent cap is global
across Pi, Claude, and Codex backends; it approximates Codex's thread setting
rather than creating eight isolated operating-system sandboxes.

Claude role defaults use exact IDs: `claude-haiku-4-5`/off for monitor,
`claude-sonnet-5`/low for explorer, `claude-sonnet-5`/medium for editor,
`claude-opus-4-8`/high for worker, and `claude-fable-5`/high for reviewer.
These are the only Claude models accepted by the backend. Modern models use
adaptive thinking plus the SDK's native effort control; Haiku uses fixed thinking
only when explicitly enabled.

Requested child directories are resolved through the filesystem before the cwd
boundary check, so a symlink cannot silently change the child's initial cwd to
an outside directory. A role can explicitly allow an outside initial cwd.

## Safety boundary

This is not ongoing filesystem confinement: Pi tools can receive absolute paths.
Pi has no operating-system permission sandbox. In-process children also share
the parent process and model registry. Tool allowlists are useful capability
controls, not filesystem containment. Explorer and reviewer omit shell and write
tools. Worker has full coding tools and must receive bounded ownership.

Do not run multiple writers against overlapping files in one checkout. Give
them separate git worktrees or strictly disjoint file/symbol ownership. An
optional future Pi RPC backend may improve crash and process isolation, but it
must explicitly propagate extension-registered providers and a filtered
environment before becoming a safe default.

## Validation

Run from the repository root:

    npm ci
    npm run format:check
    npm run check
    npm test
    npm --workspace extensions/subagents test

The subagents suite covers registration and child denylisting, role parsing and
cwd policy, simultaneous concurrency reservation, send/restart, interrupt,
close, deferred delivery, context accounting, and dashboard selection. Live
Claude/Codex tests remain opt-in because they require authenticated CLIs.
