---
summary: "Calibrate Grok 4.5 for Pi editor and bounded worker subagents"
read_when: "reviewing Pi subagent model-routing decisions"
owner: "@budivoogt"
related: ""
---
# Grok subagent routing

## Goal
- Add Grok 4.5 where evaluation showed a useful speed/quality trade-off without weakening serious worker or reviewer defaults.

## Decisions
- Pi `editor` defaults to `xai/grok-4.5` with low effort because the role is limited to small, already-decided, mechanically verifiable edits.
- Pi `worker` remains `openai-codex/gpt-5.6-terra` with high effort.
- `xai/grok-4.5` with medium effort is an explicit worker override only for bounded implementation with a known design, deterministic validation, and rollback path.
- Grok is not used with off/high effort or for reviewer work.
- Claude mappings remain Sonnet 5/medium for editor, Opus 4.8/high for worker, and Fable 5/high for reviewer.

## Evidence
- A localized editor evaluation found Grok low, Luna medium, and Sonnet medium functionally equivalent, with Grok low returning fastest.
- Harder worker evaluations showed Grok medium can handle bounded implementation but was less consistently reliable than Terra/Opus across hidden invariants and architecture work.
- Grok high did not produce a dependable quality improvement; Grok off missed required worker edge cases.

## Validation
- Update bundled-role assertions for the Pi editor model and effort.
- Run formatting, TypeScript checks, and the subagent test suite.
