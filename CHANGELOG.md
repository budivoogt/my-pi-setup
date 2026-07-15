# Changelog

## Unreleased

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
