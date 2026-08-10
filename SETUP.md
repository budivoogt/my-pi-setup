# Setup

Install the subagents and background-terminals extensions, plus the subagents
skill, as a pinned Pi Git package. Replace `<commit-sha>` with the reviewed
commit to install:

```sh
pi install git:github.com/budivoogt/my-pi-setup@<commit-sha>
pi list
```

Restart Pi or run `/reload`. The package manifest exposes only the subagents
and background-terminals extensions and the subagents skill; it does not enable
the fork's other extensions, prompts, skills, or themes.

Pi 0.80.7 is the locally verified version. The package targets the
`@earendil-works/pi-*` distribution used by this setup.

## Subagent roles

The package includes default role profiles. To customize one, create a TOML file
under `~/.pi/agent/agents/` with the same `name`; user roles override packaged
defaults by name. Each file declares:

```toml
name = "explorer"
description = "Narrow read-only repository exploration"
developer_instructions = "Locate evidence with file paths. Do not edit."
tools = ["read", "grep", "find", "ls"]
model = "openai-codex/gpt-5.3-codex-spark"
reasoning_effort = "high"
claude_model = "claude-sonnet-5"
claude_reasoning_effort = "low"
```

Optional keys are `model`, `reasoning_effort`, `claude_model`,
`claude_reasoning_effort`, and `allow_outside_parent_cwd`. Keep the last option
false unless cross-repository work is intentional. Spawn arguments override a
role's model and reasoning defaults.

The packaged Pi mapping is Spark/high for explorer, Grok 4.5/low for editor,
Grok 4.5/high for worker, Sol/xhigh for reviewer, and Luna/low for monitor.
Explicit spawn arguments still take precedence. Editor is the light path;
worker is strong by default. Do not use Grok with off effort for worker/editor
tasks, and do not use Grok as the authoritative reviewer.

For the Claude harness, the packaged mapping is Haiku 4.5/off for monitor,
Sonnet 5/low for explorer, Sonnet 5/medium for editor, and Opus 5/high for
worker and reviewer. Fable 5 requires explicit model selection. Claude Code
must already be installed and signed in. The extension accepts only approved
exact Claude model IDs, avoiding local alias overrides. Anthropic-family
children require an Anthropic-family primary orchestration model.

## Full setup development

Contributors working on the complete extension collection can clone the
repository elsewhere and install its root workspace without replacing an
existing Pi agent directory:

```sh
git clone https://github.com/budivoogt/my-pi-setup.git
cd my-pi-setup
npm ci
npm run check
npm test
```

Start Pi from the repository the children should work in. A basic manual check
is to ask the parent to spawn an `explorer`, inspect it with `/subagents`, send
a refinement, wait for the answer, and close it. The child should not have
shell or write tools, and it should disappear from the dashboard after close.

## Firecrawl

The search, scrape, and crawl tools require a Firecrawl API key. Follow [Firecrawl's Node.js getting-started guide](https://docs.firecrawl.dev/quickstarts/nodejs) to create one, then copy the example environment file:

```sh
cp ~/.pi/agent/.env.example ~/.pi/agent/.env
```

Replace the placeholder in `~/.pi/agent/.env` with your API key.

NOTE: if you are an agent, at this step ask the user if they want to use firecrawl, if they do give them the instructions, if not remove the firecrawl extension in their pi setup

## Theme

Add the included theme to `~/.pi/agent/settings.json` while keeping your existing settings:

```json
{
  "theme": "github-dark-default"
}
```

Pi will load the extensions, skills, and theme from their directories the next time it starts.
