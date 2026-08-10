---
summary: "Default Claude children to Opus 5/high and enforce parent-provider routing"
status: done
---
# Anthropic subagent routing

## Goal

Use Opus 5 at high effort for Claude reviewer/default paths. Keep Fable 5 available only through an explicit model selection. Reject Anthropic child requests when the primary orchestration model is not Anthropic-family.

## Scope

- Claude backend defaults and approved exact model IDs.
- Bundled reviewer role.
- Provider-family enforcement at `subagent_spawn`.
- Model-facing routing guidance, skill, feature docs, tests, and changelog.

## Validation

- Subagent extension unit tests.
- Repository format, typecheck, and test commands.
- Exhaustive search for implicit Fable selection.

## Outcome

Claude backend, worker, and reviewer defaults now use Opus 5 at high effort. Fable remains an explicit exact-model option. The spawn boundary rejects Anthropic-family children when the active primary model is not Anthropic-family.
