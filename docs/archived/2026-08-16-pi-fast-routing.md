---
summary: "Route Pi Luna roles through Fast service tier"
status: complete
---

# Pi Fast routing

## Scope

Update only the Pi harness role defaults: move explorer to Luna/high, route all
Luna roles through Fast, and move editor and worker to Grok 4.6 at low and
medium effort respectively.

## Implementation

- Added the typed `service_tier = "fast"` role contract.
- Applied it only in the Pi backend, mapping it to provider request
  `serviceTier: "priority"` when the effective provider is `openai-codex`.
- Bound the original stream function before wrapping it and ignored Fast for
  non-OpenAI model overrides.
- Updated deterministic role parsing, default-resolution, and provider-option
  mapping coverage.

## Validation

The full deterministic suite, TypeScript check, Prettier check, and focused
provider-boundary regression tests passed before PR creation.
