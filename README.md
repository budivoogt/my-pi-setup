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
- adds workflows to pi
- adds an ask user tool, which lets the model ask multiple choice questions

## Subagents

Each child has a fresh context window and a persistent session. The parent can
spawn work without blocking, steer a running child, continue it after
completion, wait for results, interrupt the active turn, or close the session.
Unawaited results are delivered automatically when the parent becomes idle.

| Tool | Purpose |
| --- | --- |
| `subagent_spawn` | Start a child and immediately return its id. |
| `subagent_send` | Steer an active turn or continue the same idle session. |
| `subagent_wait` | Wait for selected children and consume their results. |
| `subagent_interrupt` | Stop one active turn while keeping the session. |
| `subagent_close` | Stop if needed, dispose, and remove a child. |
| `subagent_check` / `subagent_list` | Inspect current activity without blocking. |

Pi children use role profiles from [`agents/`](agents/). The included roles are
`explorer`, `reviewer`, `editor`, `worker`, and `monitor`. A role supplies durable
system instructions, model/thinking defaults, and an exact Pi tool allowlist.
Omitting the role for a Pi child selects `worker`.

The parent enforces a four-child concurrency cap and Pi children cannot spawn
more children. Role-based checks restrict the child's initial working directory
to the parent's tree unless a role explicitly opts out.

> This initial-directory check is not a filesystem sandbox: tools can accept
> absolute paths. Pi does not provide operating-system sandboxing. A role without `bash`,
> `edit`, or `write` is meaningfully narrower, but a write-capable child still
> has the parent process's filesystem and environment permissions. Give parallel
> writers non-overlapping ownership or separate git worktrees.

![Pi setup interface](assets/pi-setup.jpeg)

Installation and verification are in [`SETUP.md`](SETUP.md). Architecture and
safety details are in [`docs/features/subagents.md`](docs/features/subagents.md).
