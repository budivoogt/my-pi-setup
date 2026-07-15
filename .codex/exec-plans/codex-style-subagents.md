# Build Codex-style subagents for Pi

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. It follows the shared ExecPlan requirements in `/Users/budi_daily/Documents/Coding/projects/Svelte/agent-scripts/docs/templates/exec-plan.md`.

## Purpose / Big Picture

After this work, a Pi session can delegate a self-contained task to a persistent child agent, keep working while the child runs, steer the child with a follow-up message, wait for activity or completion, interrupt its current turn, and close its session. Child roles are declared in standalone TOML files, with durable system instructions and explicit tool allowlists. The parent remains responsible for synthesis, while deferred completion delivery prevents child transcripts from flooding the parent context.

The feature is observable through Pi's model-facing subagent tools and `/subagents` dashboard. Automated tests prove lifecycle behavior, concurrency reservation, role parsing, tool restrictions, cwd boundaries, deferred-delivery deduplication, and teardown.

## Progress

- [x] (2026-07-15 14:53Z) Forked `davis7dotsh/my-pi-setup` at `d8534d7` to `budivoogt/my-pi-setup` and created this feature worktree.
- [x] (2026-07-15 14:53Z) Audited Davis's manager/backend architecture and Ogulcan Celik's RPC-based Pi subagents.
- [x] (2026-07-15 15:18Z) Convert all packaged extensions to one root npm workspace and lockfile so clean root installation includes every imported dependency.
- [x] (2026-07-15 15:42Z) Added standalone role loading and enforced durable role instructions, exact tools, and initial-cwd policy in the Pi backend.
- [x] (2026-07-15 15:55Z) Exposed send, interrupt, and close as model-facing tools and made lifecycle transitions race-safe.
- [x] (2026-07-15 16:18Z) Added concurrency, role-policy, cleanup, deferred-delivery generation, and lifecycle tests.
- [x] (2026-07-15 16:35Z) Updated installation, configuration, provenance, licensing, and safety documentation.
- [x] (2026-07-15 17:28Z) Passed formatting, type checks, 119 offline tests, 34 focused subagent tests, an independent race probe, and a live Pi parent-to-child lifecycle smoke test.

## Surprises & Discoveries

- Observation: Davis's current manager already supports persistent multi-turn sessions through `SubagentManager.send`, but send is exposed only in the interactive takeover UI.
  Evidence: `extensions/subagents/src/manager.ts` implements `send`; `extensions/subagents/index.ts` registers spawn, wait, cancel, check, and list but no send tool.

- Observation: the installed Pi SDK accepts both a tool allowlist and appended system-prompt text for in-process child sessions.
  Evidence: Pi 0.80.7's `CreateAgentSessionOptions` includes `tools`, while `DefaultResourceLoaderOptions` includes `appendSystemPrompt`.

- Observation: a clean root `npm install` does not install the nested subagents dependencies because the repository is not configured as an npm workspace.
  Evidence: root `package.json` omits `workspaces`; `effect` and the Claude SDK exist only in `extensions/subagents/package.json`.

- Observation: adding only the subagents workspace exposed the same pre-existing install defect in `git-info`, which imports `@effect/platform-node` from its own nested manifest.
  Evidence: the first full root check failed with `Cannot find module '@effect/platform-node'`; expanding the workspace to `extensions/*` makes root installation match all packaged extension manifests.

- Observation: without a repository-local Prettier config, Prettier inherited an unrelated config from the worktree's parent directory and rewrote the repository.
  Evidence: `prettier --find-config-path` initially returned `../../.prettierrc`; adding `.prettierrc.json` makes formatting deterministic and allowed the unrelated churn to be removed.

- Observation: deferred delivery must consume an exact child turn, not every queued turn for the same child id.
  Evidence: a targeted test and independent reviewer probe retain turn 1 while an explicit wait consumes turn 2 by `(id, runSequence)`.

## Decision Log

- Decision: Use Davis's implementation as the architectural and code base, with explicit provenance, because the user confirmed the author's permission.
  Rationale: its manager, deferred delivery, event normalization, cancellation, and TUI are more complete than the alternative extension.
  Date/Author: 2026-07-15 / Codex

- Decision: Keep the backend interface and existing adapters in the first milestone, but harden the Pi backend and make Pi the documented default.
  Rationale: deleting working adapters is unnecessary for the requested Pi capability, while the interface remains useful for tests and later process isolation.
  Date/Author: 2026-07-15 / Codex

- Decision: Use TOML role files under `agents/`, matching Codex CLI's standalone role-contract pattern.
  Rationale: role instructions and tool policy should be durable configuration rather than concatenated task text.
  Date/Author: 2026-07-15 / Codex

- Decision: Keep nested orchestration disabled for child sessions and use a default concurrency cap of four.
  Rationale: depth one and a conservative thread cap avoid runaway recursion and process/model fan-out; both can be revisited after lifecycle tests are mature.
  Date/Author: 2026-07-15 / Codex

- Decision: Keep the in-process Pi SDK backend as the default and defer an optional RPC isolation backend.
  Rationale: Pi 0.80.7 can reuse the parent's model registry and extension resources directly; a separate RPC process needs explicit provider, credential, environment, and shutdown propagation before it is safer than the in-process path.
  Date/Author: 2026-07-15 / Codex

## Outcomes & Retrospective

The milestone is complete. Pi now has a persistent Codex-style child lifecycle, standalone role contracts, fail-closed role loading, exact child tool validation, bounded concurrency, serialized lifecycle transitions, and generation-aware deferred delivery. The full offline test suite passes 119/119 and focused subagent tests pass 34/34. A real Pi run spawned an `explorer`, read the pinned Pi dependency from `package.json` in a child session, waited, closed the child, and returned `0.80.7` successfully.

The first milestone deliberately does not claim operating-system isolation. Tool allowlists and initial-cwd checks narrow intended capability, but Pi children run in-process with the parent's filesystem and environment permissions. A process-isolated RPC backend remains a possible follow-up after provider and environment propagation are designed explicitly.

## Context and Orientation

`extensions/subagents/index.ts` is the Pi extension entrypoint. It registers parent-facing tools, hooks parent-session lifecycle events, queues deferred results, and owns the dashboard wiring. `extensions/subagents/src/manager.ts` stores each child in a registry, folds backend events into snapshots, enforces the running-agent cap, and controls wait, send, cancel, pruning, and teardown. `extensions/subagents/src/backend.ts` defines the common persistent-session contract. `extensions/subagents/src/backends/pi.ts` creates an in-process Pi `AgentSession`; this is the primary path being hardened. The Claude and Codex adapters translate their native protocols into the same event model.

A role is a named TOML file in `agents/`. It contains durable developer instructions plus model, reasoning, tool, and working-directory defaults. Durable means the instructions are appended to the child session's system prompt, rather than placed only in its first user message. A tool allowlist names exactly which Pi tools the role may call. An initial-cwd check prevents a child from starting outside the parent's current repository unless the role explicitly permits it. It is not filesystem containment; tools that accept absolute paths still have the parent process's permissions.

The lifecycle terms mirror Codex: spawn creates a persistent child session and immediately returns an id; send steers a running turn or starts another turn in an idle session; wait blocks for selected children; interrupt aborts active work but retains the session for a later send; close aborts if necessary, releases resources, and removes the child from the active registry.

## Plan of Work

First, convert the root into an npm workspace containing every packaged extension under `extensions/*`, use one lockfile, and ensure all runtime dependencies install from the documented root command. Keep dependency changes mechanical and pinned where upstream currently relies on beta APIs.

Second, add `extensions/subagents/src/roles.ts`. It will discover `agents/*.toml` beneath Pi's agent directory, validate a small explicit schema, reject duplicate role names and invalid reasoning levels, and return clear diagnostics. Add default explorer, reviewer, worker, editor, and monitor roles. Extend `SpawnTask` and snapshots with role metadata. Resolve the role in the tool layer, apply its model and effort defaults, validate the requested cwd, pass its tool allowlist into `createAgentSession`, and append its instructions to the child resource loader's system prompt.

Third, expose manager `send` through `subagent_send`, rename cancellation semantics in documentation to interruption while preserving the compatible `subagent_cancel` tool, and add `subagent_close`. Closing must be bounded, preserve already-settled deferred results, remove the entry, and make later send/check calls fail clearly. Update every child denylist so children cannot invoke any orchestration tool.

Fourth, add unit tests before or with behavior changes. Role tests cover valid loading, malformed TOML, duplicate names, cwd containment, and default application. Manager tests cover simultaneous cap reservation, send after completion, interrupt then restart, close of running and idle children, and shutdown disposal. Tool-facing helpers must remain separately testable without paid model calls.

Finally, update the README, setup guide, role examples, software license, and third-party provenance. Then run installation, formatting, type checking, unit tests, and an opt-in live Pi smoke using a configured local model. Do not claim sandbox isolation: Pi children have the same operating-system permissions as the parent process, and write-capable roles must be coordinated by the parent or separated into worktrees.

## Concrete Steps

All commands run from `/Users/budi_daily/Documents/Coding/worktrees/my-pi-setup-codex-subagents` on branch `feat/codex-style-subagents`.

Use `npm install` after adding the workspace declaration, then run:

    npm run format:check
    npm run check
    npm test
    npm --workspace extensions/subagents test

For local smoke verification, launch Pi with the extension from this checkout, ask it to spawn the explorer role on a read-only repository question, send a refinement, wait for completion, then close the child. The dashboard should show one running entry, preserve its transcript across send, and remove it after close.

## Validation and Acceptance

Acceptance requires a clean dependency install and all non-live tests passing. Role parsing must reject unknown tools only when Pi cannot expose them, enforce the parent's cwd boundary by default, and make explorer/reviewer roles omit bash/edit/write. A child role's instructions must appear in its effective system prompt in a backend test or live smoke. Five concurrent spawn attempts must produce four children and one concurrency error. Interrupt must stop a running child without destroying its session, a subsequent send must create another completed turn, and close must dispose the session and make the id unavailable. Deferred output must be delivered once, and explicit wait must prevent duplicate delivery.

The extension must register spawn, send, wait, cancel/interrupt, close, check, and list. Child sessions must not receive any of those tools. Parent shutdown must dispose all children within bounded time.

## Idempotence and Recovery

Dependency installation and tests are repeatable. The feature work stays isolated in this worktree. If a child test hangs, the manager's bounded teardown should terminate it; otherwise stop the test process and inspect the failing lifecycle case before retrying. No cleanup of the worktree or branch is authorized. Upstream remains configured as a separate remote so Davis's later changes can be compared without overwriting this branch.

## Artifacts and Notes

Fork: `https://github.com/budivoogt/my-pi-setup`

Upstream snapshot: `d8534d7e6ec6609b7e684a8a0eb2e7a0195115ba`

Alternative implementation reviewed: `ogulcancelik/pi-extensions`, package `pi-codex-subagents`, snapshot `76d35ac1a14746c90e9dafc2f84ae4adac7ef9ef`.

## Interfaces and Dependencies

`RoleProfile` in `extensions/subagents/src/roles.ts` must expose `name`, `description`, `developerInstructions`, optional `model`, optional `reasoningEffort`, a readonly `tools` list, and cwd policy. `loadRoleProfiles(agentDir)` returns validated profiles or throws a diagnostic containing the source path. `resolveWorkingDirectory(parentCwd, requested, role)` returns an absolute directory or throws before spawn.

`SpawnTask` gains the resolved role profile values needed by backends. The Pi backend passes the role's tools to `createAgentSession` and appends its durable instructions through `DefaultResourceLoader`. The manager gains a bounded `close(id)` effect. The entrypoint registers `subagent_send` and `subagent_close`, while preserving existing tool names for compatibility.

Plan revision note (2026-07-15): created the initial self-contained implementation plan after the upstream and alternative architecture audits. Expanded packaging from a subagents-only workspace to all packaged extensions after the full root check proved the same nested-install defect affected `git-info`. Closed the plan after offline, focused, reviewer-probe, and live Pi verification.
