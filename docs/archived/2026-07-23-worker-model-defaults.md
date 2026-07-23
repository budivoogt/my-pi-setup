---
summary: "Worker defaults: strong by default; editor is the light path"
read_when: "reviewing subagent worker/editor model defaults"
owner: "@budivoogt"
related: "docs/archived/2026-07-19-grok-subagent-routing.md"
---
# Worker model defaults (2026-07-23, revised)

## Final decisions
- `editor` is the light path (Grok low / Sonnet medium / Luna medium).
- `worker` is strong by default:
  - Pi: `xai/grok-4.5` / `high`
  - Claude: `claude-opus-4-8` / `high`
  - Codex: `gpt-5.6-terra` / `high`
- No cheap-worker + escalate-to-strong-worker tier. That nuance is redundant with `editor` and under-escalates in practice.
- Blocked workers return to the parent (parent/reviewer/user), not to a hidden medium tier.
- `docs_researcher` deprecated; fold docs into `explorer`.
- Native-for-native harness routing retained.

## Evidence notes
- Synthetic benches showed cheap models can pass well-specified tasks, which supports a light **editor** path.
- Operationally, judging "hard enough for Opus/Terra" is unreliable without an auto-router; prefer strong worker defaults.
