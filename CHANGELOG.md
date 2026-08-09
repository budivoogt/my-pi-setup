# Changelog

## Unreleased

- Add a dedicated read-only Luna/medium role for parents to select after a structured Spark quota or authentication failure; keep Pi editor routing on Grok/low and Claude Code exploration on Sonnet.
- Align the stale worker-role test with the existing Claude Opus 5/high mapping.

- Historical strong-worker default, superseded by the Opus 5 alignment above: Pi Grok 4.5/high, Claude Opus 4.8/high; editor remains the light path (no cheap-worker escalate tier).

- Default Pi workers to Grok 4.5/medium and Claude workers to Sonnet 5/high;
  escalate to Terra/high or Opus/high for ambiguous, high-risk, or failed-validation work.
- Treat Grok high as red-team / same-family retry rather than default implementation effort.
- Document native-for-native harness routing and top-model red-team panel seats.

- Route Pi editor subagents to Grok 4.5/low, retain Terra/high as the default
  worker, and document Grok 4.5/medium as a bounded-worker override while
  excluding Grok off/high and reviewer use.
- Enable session-scoped background terminals in the Pi package, keep their
  routing policy in extension prompt metadata, and remove the redundant skill.
- Hide subagent takeover reasoning by default while preserving `Ctrl+T` as an
  on-demand visibility toggle; tool results remain concise one-line previews.
- Add pinned Claude role mappings through the Pi extension, including Sonnet 5
  low adaptive effort for explorer and an exact approved-model allowlist.
- Add persistent Pi subagent roles with durable instructions, tool allowlists,
  model/thinking defaults, and parent-directory confinement.
- Add model-facing send, interrupt, and close lifecycle tools.
- Add race-safe close handling, simultaneous concurrency tests, and child
  orchestration denylist coverage.
- Make waits include follow-up turns queued on active Claude/Codex children and
  keep close bounded when another wait also tracks unrelated children; use a
  FIFO event barrier and backend-authoritative send disposition so buffered
  lifecycle state cannot expose an earlier turn.
- Make deferred completion consumption generation-aware so waiting for a later
  turn cannot discard an earlier queued result.
- Make the nested subagents package install from the root npm workspace.
- Add a repository-local Prettier configuration for deterministic formatting.
- Add MIT licensing and upstream provenance for the authorized fork.
- Expose only the subagents extension and skill through a first-class Pi package
  manifest, with bundled role defaults and user overrides by role name.
- Mirror the local Codex CLI role models and its eight-thread concurrency limit.
