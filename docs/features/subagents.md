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

Pi role defaults are bundled under `extensions/subagents/agents/`. User TOML
files under `~/.pi/agent/agents/` override bundled profiles by role name. Each
profile requires `name`, `description`, `developer_instructions`, and a
non-empty `tools` array. Optional fields are `model`, `reasoning_effort`, and
`allow_outside_parent_cwd`.

The tool layer resolves the role before spawn. User-supplied model and effort
values override role defaults. The role's instructions are appended to Pi's
system prompt, and its tools are passed to `createAgentSession` as an allowlist.
The backend denylist is applied afterward and always removes orchestration,
workflow, and user-question tools.

Bundled models intentionally mirror this setup's Codex CLI roles and fail fast
when a configured provider/model is unavailable. The eight-agent cap is global
across Pi, Claude, and Codex backends; it approximates Codex's thread setting
rather than creating eight isolated operating-system sandboxes.

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
