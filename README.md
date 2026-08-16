# Pi setup with persistent subagents

This is an opinionated Pi configuration and extension collection, forked from
[`davis7dotsh/my-pi-setup`](https://github.com/davis7dotsh/my-pi-setup). Its
subagent extension provides a Codex-style lifecycle while keeping Pi's own
session and model infrastructure.

This setup is fairly opinionated, it:

- sets up github dark default as the theme
- adds firecrawl tools for searching and scraping
- updates the bottom bar to have the info I prefer to see
- adds subagents to pi
- adds session-scoped background terminals with a `/ps` viewer
- adds workflows to pi
- adds an ask user tool, which lets the model ask multiple choice questions

## Subagents

Each child has a fresh context window and a persistent session. The parent can
spawn work without blocking, steer a running child, continue it after
completion, wait for results, interrupt the active turn, or close the session.
Unawaited results are delivered automatically when the parent becomes idle.

| Tool                               | Purpose                                                 |
| ---------------------------------- | ------------------------------------------------------- |
| `subagent_spawn`                   | Start a child and immediately return its id.            |
| `subagent_send`                    | Steer an active turn or continue the same idle session. |
| `subagent_wait`                    | Wait for selected children and consume their results.   |
| `subagent_interrupt`               | Stop one active turn while keeping the session.         |
| `subagent_close`                   | Stop if needed, dispose, and remove a child.            |
| `subagent_check` / `subagent_list` | Inspect current activity without blocking.              |

Pi children use bundled role profiles from
[`extensions/subagents/agents/`](extensions/subagents/agents/). The included
roles are `explorer`, `luna-explorer`, `reviewer`, `editor`, `worker`, and
`monitor`. A role
supplies durable system instructions, harness-specific model/thinking defaults,
and an exact tool allowlist. Omitting the role for a Pi or Claude child selects
`worker`.
Files in `~/.pi/agent/agents/*.toml` override bundled roles by role name.

Claude roles use exact model IDs through the Claude Agent SDK and the installed
Claude Code login: Haiku 4.5/off for monitor, Sonnet 5/low for explorer,
Sonnet 5/medium for editor, Opus 4.8/high for worker, and Fable 5/high for
reviewer. The Sonnet 5 levels use native adaptive effort rather than legacy
fixed thinking-token budgets. Pi routes `explorer` to Luna/high/Fast,
`luna-explorer` to Luna/medium/Fast, and `monitor` to Luna/low/Fast. Pi workers
default to Grok 4.6/medium; editors stay on Grok 4.6/low. Fast maps to
`priority` only for effective `openai-codex` requests.

The parent enforces an eight-child concurrency cap and Pi children cannot spawn
more children. Role-based checks restrict the child's initial working directory
to the parent's tree unless a role explicitly opts out.

> This initial-directory check is not a filesystem sandbox: tools can accept
> absolute paths. Pi does not provide operating-system sandboxing. A role without `bash`,
> `edit`, or `write` is meaningfully narrower, but a write-capable child still
> has the parent process's filesystem and environment permissions. Give parallel
> writers non-overlapping ownership or separate git worktrees.

## Background terminals

Use `bg_start` for temporary, non-interactive processes such as dev servers,
watchers, and long builds. Pi can inspect them with `bg_status` or `/ps`, stop
them with `bg_kill`, and receives their final output automatically.

Use tmux instead when a process requires interactive input or must survive a Pi
reload, session change, or exit. Background terminals are deliberately tied to
the owning Pi session and are cleaned up during teardown.

![Pi setup interface](assets/pi-setup.jpeg)

Installation and verification are in [`SETUP.md`](SETUP.md). Architecture and
safety details are in [`docs/features/subagents.md`](docs/features/subagents.md)
and [`docs/features/background-terminals.md`](docs/features/background-terminals.md).
