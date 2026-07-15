# Setup

Clone this repository to Pi's agent directory, then install the root workspace.
The workspace declaration installs the nested subagents package and its runtime
dependencies with one lockfile.

```sh
cd ~/.pi/agent
npm ci
npm run check
npm test
```

Pi 0.80.7 is the locally verified version. The package targets the
`@earendil-works/pi-*` distribution used by this setup.

## Subagent roles

Role profiles live in `~/.pi/agent/agents/*.toml`. Each file declares:

```toml
name = "explorer"
description = "Narrow read-only repository exploration"
developer_instructions = "Locate evidence with file paths. Do not edit."
tools = ["read", "grep", "find", "ls"]
reasoning_effort = "high"
```

Optional keys are `model`, `reasoning_effort`, and
`allow_outside_parent_cwd`. Keep the last option false unless cross-repository
work is intentional. Pi spawn arguments override a role's model and reasoning
defaults.

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
