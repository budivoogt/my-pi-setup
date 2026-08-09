---
summary: "Add a read-only Luna fallback after Spark"
read_when: archived
owner: "@budivoogt"
related: ""
---
# Luna explorer fallback

## Goal
- Add a read-only Luna fallback after Spark without changing Pi editor or Claude Code routing.

## Context
- Pi explorer uses Spark, which can exhaust its separate Codex quota.
- Reusing the editor role would leave write tools available during read-only fallback.

## Plan / TODOs
- [x] Add a dedicated Luna/medium read-only role.
- [x] Preserve Pi editor Grok/low and Claude Code Sonnet mappings.
- [x] Run focused role tests and TypeScript checks.

## Decisions
- Use a dedicated role so the fallback cannot edit files.

## Links / Artifacts
- `extensions/subagents/agents/luna-explorer.toml`
- `extensions/subagents/roles.test.ts`

## Next steps / Handoff
- None.
