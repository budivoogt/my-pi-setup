# Changelog

## Unreleased

- Add pinned Claude role mappings through the Pi extension, including Sonnet 5
  low adaptive effort for explorer and an exact approved-model allowlist.
- Add persistent Pi subagent roles with durable instructions, tool allowlists,
  model/thinking defaults, and parent-directory confinement.
- Add model-facing send, interrupt, and close lifecycle tools.
- Add race-safe close handling, simultaneous concurrency tests, and child
  orchestration denylist coverage.
- Make deferred completion consumption generation-aware so waiting for a later
  turn cannot discard an earlier queued result.
- Make the nested subagents package install from the root npm workspace.
- Add a repository-local Prettier configuration for deterministic formatting.
- Add MIT licensing and upstream provenance for the authorized fork.
- Expose only the subagents extension and skill through a first-class Pi package
  manifest, with bundled role defaults and user overrides by role name.
- Mirror the local Codex CLI role models and its eight-thread concurrency limit.
