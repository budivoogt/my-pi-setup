---
summary: "Codex-style persistent subagents for Pi"
read_when: archived
owner: "@budivoogt"
related: "https://github.com/davis7dotsh/my-pi-setup"
---
# Codex-style subagents

## Outcome

- Added role-driven persistent Pi children with spawn, send, wait, interrupt,
  close, check, and list semantics.
- Added exact child tool allowlists, durable role instructions, initial-cwd
  validation, fail-closed role loading, and an eight-child concurrency cap.
- Made lifecycle transitions and generation-aware deferred delivery race-safe.
- Consolidated packaged extensions into one root npm workspace and lockfile.
- Documented installation, safety limits, licensing, and provenance.

## Verification

- Root formatting and TypeScript checks pass.
- Full offline suite: 131/131 passing.
- Focused subagent suite: 46/46 passing.
- Targeted lifecycle coverage proves waits include queued follow-up turns and
  close is not blocked by an unrelated sibling in a multi-agent wait; interrupt
  uses a FIFO event barrier before exposing terminal state.
- Independent probe verified that waiting for turn 2 does not consume queued turn 1.
- Live Pi smoke spawned an `explorer`, read the pinned Pi dependency from
  `package.json`, waited, closed the child, and returned `0.80.7`.

## Decisions

- Davis's manager and deferred-delivery implementation remain the base.
- Pi's in-process SDK backend is the default because it reuses the parent's
  model registry and resources cleanly on Pi 0.80.7.
- An optional process/RPC backend is deferred until provider, credential,
  environment, and shutdown propagation are designed explicitly.
- Packaged defaults mirror the local Codex role models; user TOMLs override
  those defaults by role name.
- Role cwd policy controls only the initial directory. It is not filesystem
  containment; write-capable parallel children still need separate ownership
  or worktrees.

## Links / Artifacts

- ExecPlan: `.codex/exec-plans/codex-style-subagents.md`
- Fork: `https://github.com/budivoogt/my-pi-setup`
- Upstream snapshot: `d8534d7e6ec6609b7e684a8a0eb2e7a0195115ba`
