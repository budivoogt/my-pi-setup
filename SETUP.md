# Setup

## Temporary SDK prerequisite

Install the [immutable SDK fork](https://github.com/budivoogt/pi/releases/tag/sdk-runtime-41aee614)
before updating this package. Its version still reads `0.85.1`, so checking the
version alone does not prove the patch is present. Download, verify, then install:

```sh
curl --fail --location --output pi-sdk.tgz \
  https://github.com/budivoogt/pi/releases/download/sdk-runtime-41aee614/earendil-works-pi-coding-agent-0.85.1.tgz &&
printf '%s  %s\n' 3fb5eaa7eaf4217cd09af8161534d40094be6a9acdf811830c50c1681417ca0f pi-sdk.tgz | \
  shasum --algorithm 256 --check &&
npm install --global --ignore-scripts --omit=dev ./pi-sdk.tgz
```

Keep the SDK and extension pins together. Restart Pi after an SDK change;
`/reload` does not replace the running SDK. Keep the prior SDK archive and
extension pin for rollback. Do not independently update to the official SDK
until the public API described below is released.

## Extension package

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

Pi 0.85.1 is the locally verified version. The package targets the
`@earendil-works/pi-*` distribution used by this setup.

Child Pi sessions and workflow agents must reuse the parent `ModelRuntime`
(`ctx.modelRuntime`, also available as `ModelRegistry.modelRuntime`). That
public accessor is not in an official `@earendil-works/pi-coding-agent`
release yet. Until [earendil-works/pi#8791](https://github.com/earendil-works/pi/issues/8791)
ships, install this package against a temporary patched 0.85.1 SDK that
exposes those APIs. Return to the official package once the upstream public
API is released.

## Subagent roles

The package includes default role profiles. To customize one, create a TOML file
under `~/.pi/agent/agents/` with the same `name`; user roles override packaged
defaults by name. Each file declares:

```toml
name = "explorer"
description = "Narrow read-only repository exploration"
developer_instructions = "Locate evidence with file paths. Do not edit."
tools = ["read", "grep", "find", "ls"]
model = "openai-codex/gpt-5.6-luna"
reasoning_effort = "high"
service_tier = "fast"
claude_model = "claude-sonnet-5"
claude_reasoning_effort = "low"
```

Optional keys are `model`, `reasoning_effort`, `service_tier`, `claude_model`,
`claude_reasoning_effort`, and `allow_outside_parent_cwd`. Keep the last option
false unless cross-repository work is intentional. Spawn arguments override a
role's model and reasoning defaults. `service_tier = "fast"` is a Pi-only role
default, mapped to `priority` only when the effective request provider is
`openai-codex`; non-OpenAI model overrides ignore it.

The packaged Pi mapping is Luna/high/Fast for explorer, Luna/medium/Fast for
luna-explorer, Luna/low/Fast for monitor, Grok 4.6/low for editor, Grok
4.6/medium for worker, and Sol/xhigh for reviewer. Explicit spawn arguments
still take precedence for model and reasoning effort. Editor is the light path;
worker is strong by default. Do not use Grok with off effort for worker/editor
tasks, and do not use Grok as the authoritative reviewer.

For the Claude harness, the packaged mapping is Haiku 4.5/off for monitor,
Sonnet 5/low for explorer, Sonnet 5/medium for editor, Opus 4.8/high for
worker, and Fable 5/high for reviewer. Claude Code must already be installed
and signed in. The extension accepts only those exact Claude model IDs,
avoiding local alias overrides.

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
