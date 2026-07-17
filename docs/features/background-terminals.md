# Background terminals

The background-terminals extension gives Pi first-class tools for temporary,
non-interactive processes while keeping durable terminal ownership in tmux.

## Routing policy

- Use `bg_start` for temporary dev servers, watchers, long builds, and similar
  commands that should run while Pi continues working.
- Use regular `bash` for quick commands.
- Use tmux when a process requires interactive input or must survive a Pi
  reload, session change, or exit.

This policy is model-facing through the extension's `promptGuidelines`. It does
not require a separate skill.

## Tools and UI

| Surface | Purpose |
| --- | --- |
| `bg_start` | Start a command without blocking the agent. |
| `bg_status` | Inspect current status and tail-truncated output. |
| `bg_list` | List running and settled terminals. |
| `bg_kill` | Stop one or more process trees. |
| `/ps` | Inspect and stop terminals in the interactive UI. |

Commands receive no stdin. Output shown to the model is bounded, while complete
stdout and stderr are written to private temporary spill files for the session.
Pi automatically receives a completion message when a process exits.

## Lifecycle

Background terminals belong to the current Pi session. Reloading, replacing, or
quitting the session stops their process trees and removes their temporary log
files. This cleanup boundary is intentional; use tmux for processes that need a
lifetime independent of Pi.
