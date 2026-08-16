import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  BUNDLED_ROLES_DIR,
  assertRoleWorkingDirectory,
  appendRoleSystemPrompts,
  buildRoleSystemPrompts,
  findMissingRoleTools,
  loadRoleProfiles,
  parseRoleProfile,
  resolveRoleProfile,
  roleDefaultsForHarness,
  roleForSpawn,
} from "./src/roles.ts";
import { piProviderRequestOptions } from "./src/backends/pi.ts";

const validRole = `
name = "explorer"
description = "Read-only repository exploration"
developer_instructions = "Locate evidence and do not edit files."
tools = ["read", "grep", "find", "ls", "read"]
reasoning_effort = "high"
service_tier = "fast"
claude_model = "claude-sonnet-5"
claude_reasoning_effort = "low"
`;

test("parses and normalizes a role profile", () => {
  const role = parseRoleProfile(validRole, "/roles/explorer.toml");
  assert.equal(role.name, "explorer");
  assert.equal(role.reasoningEffort, "high");
  assert.equal(role.serviceTier, "fast");
  assert.equal(role.claudeModel, "claude-sonnet-5");
  assert.equal(role.claudeReasoningEffort, "low");
  assert.deepEqual(role.tools, ["read", "grep", "find", "ls"]);
  assert.equal(role.allowOutsideParentCwd, false);
  assert.match(
    buildRoleSystemPrompts(roleForSpawn(role))[0],
    /explorer subagent/,
  );
});

test("rejects malformed and invalid role profiles with their source path", () => {
  assert.throws(
    () => parseRoleProfile('name = "broken"\ntools = [', "/roles/broken.toml"),
    /\/roles\/broken\.toml: invalid TOML/,
  );
  assert.throws(
    () =>
      parseRoleProfile(
        validRole.replace(
          'reasoning_effort = "high"',
          'reasoning_effort = "huge"',
        ),
        "/roles/explorer.toml",
      ),
    /reasoning_effort.*must be one of/,
  );
  assert.throws(
    () =>
      parseRoleProfile(
        validRole.replace(
          'claude_reasoning_effort = "low"',
          'claude_reasoning_effort = "huge"',
        ),
        "/roles/explorer.toml",
      ),
    /claude_reasoning_effort.*must be one of/,
  );
  assert.throws(
    () =>
      parseRoleProfile(
        validRole.replace('service_tier = "fast"', 'service_tier = "slow"'),
        "/roles/explorer.toml",
      ),
    /service_tier.*must be one of/,
  );
});

test("loads sorted roles and rejects duplicate role names", () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-roles-"));
  const rolesDir = path.join(agentDir, "agents");
  fs.mkdirSync(rolesDir);
  fs.writeFileSync(path.join(rolesDir, "explorer.toml"), validRole);
  fs.writeFileSync(
    path.join(rolesDir, "worker.toml"),
    validRole.replace('name = "explorer"', 'name = "worker"'),
  );
  const missingBundledDir = path.join(agentDir, "missing-bundled");
  const roles = loadRoleProfiles(agentDir, missingBundledDir);
  assert.deepEqual([...roles.keys()], ["explorer", "worker"]);
  assert.equal(resolveRoleProfile(roles, "worker").name, "worker");

  fs.writeFileSync(path.join(rolesDir, "duplicate.toml"), validRole);
  assert.throws(
    () => loadRoleProfiles(agentDir, missingBundledDir),
    /Duplicate subagent role/,
  );
});

test("loads harness-mapped bundled roles and applies whole user overrides by name", () => {
  const agentDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "subagent-overrides-"),
  );
  const rolesDir = path.join(agentDir, "agents");
  fs.mkdirSync(rolesDir);
  fs.writeFileSync(path.join(rolesDir, "local-explorer.toml"), validRole);
  fs.writeFileSync(
    path.join(rolesDir, "custom.toml"),
    validRole.replace('name = "explorer"', 'name = "custom"'),
  );

  const roles = loadRoleProfiles(agentDir);
  assert.deepEqual(
    [...roles.keys()],
    [
      "editor",
      "explorer",
      "luna-explorer",
      "monitor",
      "reviewer",
      "worker",
      "custom",
    ],
  );
  assert.equal(roles.get("explorer")?.model, undefined);
  assert.equal(roles.get("explorer")?.claudeModel, "claude-sonnet-5");
  assert.equal(roles.get("custom")?.name, "custom");

  const expectedDefaults = {
    editor: ["xai/grok-4.6", "low", undefined, "claude-sonnet-5", "medium"],
    "luna-explorer": [
      "openai-codex/gpt-5.6-luna",
      "medium",
      "fast",
      "claude-sonnet-5",
      "low",
    ],
    monitor: [
      "openai-codex/gpt-5.6-luna",
      "low",
      "fast",
      "claude-haiku-4-5",
      "off",
    ],
    reviewer: [
      "openai-codex/gpt-5.6-sol",
      "xhigh",
      undefined,
      "claude-fable-5",
      "high",
    ],
    worker: ["xai/grok-4.6", "medium", undefined, "claude-opus-5", "high"],
  } as const;
  for (const [
    name,
    [model, effort, serviceTier, claudeModel, claudeEffort],
  ] of Object.entries(expectedDefaults)) {
    assert.equal(roles.get(name)?.model, model);
    assert.equal(roles.get(name)?.reasoningEffort, effort);
    assert.equal(roles.get(name)?.serviceTier, serviceTier);
    assert.equal(roles.get(name)?.claudeModel, claudeModel);
    assert.equal(roles.get(name)?.claudeReasoningEffort, claudeEffort);
  }
  assert.deepEqual(roles.get("luna-explorer")?.tools, [
    "read",
    "grep",
    "find",
    "ls",
  ]);
  assert.ok(fs.existsSync(path.join(BUNDLED_ROLES_DIR, "worker.toml")));
});

test("bundled explorer maps Pi to Luna high fast and Claude to Sonnet 5 low", () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-defaults-"));
  const explorer = loadRoleProfiles(agentDir).get("explorer");
  assert.equal(explorer?.model, "openai-codex/gpt-5.6-luna");
  assert.equal(explorer?.reasoningEffort, "high");
  assert.equal(explorer?.serviceTier, "fast");
  assert.deepEqual(roleDefaultsForHarness(explorer!, "pi"), {
    model: "openai-codex/gpt-5.6-luna",
    reasoningEffort: "high",
    serviceTier: "fast",
  });
  assert.deepEqual(roleDefaultsForHarness(explorer!, "claude"), {
    model: "claude-sonnet-5",
    reasoningEffort: "low",
  });
  assert.deepEqual(explorer?.tools, ["read", "grep", "find", "ls"]);
});

test("maps the Pi fast role tier only for the effective OpenAI Codex provider", () => {
  assert.deepEqual(piProviderRequestOptions("fast", "openai-codex"), {
    serviceTier: "priority",
  });
  assert.deepEqual(piProviderRequestOptions("fast", "xai"), {});
  assert.deepEqual(piProviderRequestOptions(undefined, "openai-codex"), {});
});

test("roles are confined to the parent cwd unless explicitly allowed", () => {
  const role = parseRoleProfile(validRole, "/roles/explorer.toml");
  assert.doesNotThrow(() =>
    assertRoleWorkingDirectory(
      "/workspace/project",
      "/workspace/project/src",
      role,
    ),
  );
  assert.throws(
    () =>
      assertRoleWorkingDirectory(
        "/workspace/project",
        "/workspace/other",
        role,
      ),
    /cannot work outside the parent directory/,
  );
  assert.doesNotThrow(() =>
    assertRoleWorkingDirectory("/workspace/project", "/workspace/other", {
      ...role,
      allowOutsideParentCwd: true,
    }),
  );
});

test("role prompts extend existing append-system instructions", () => {
  assert.deepEqual(
    appendRoleSystemPrompts(["existing"], ["role", "contract"]),
    ["existing", "role", "contract"],
  );
});

test("reports role tools that Pi did not register", () => {
  assert.deepEqual(
    findMissingRoleTools(["read", "grepp", "ls"], ["read", "ls"]),
    ["grepp"],
  );
});

test("missing role directories and worker profiles fail closed", () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-no-roles-"));
  const roles = loadRoleProfiles(agentDir, path.join(agentDir, "missing"));
  assert.throws(
    () => resolveRoleProfile(roles, "worker"),
    /Unknown subagent role "worker".*Available roles: none/,
  );
});

test("Pi applies the exact role tools while preserving append-system instructions", async (t) => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-sdk-role-"));
  fs.writeFileSync(
    path.join(agentDir, "APPEND_SYSTEM.md"),
    "Existing operator instruction.",
  );
  const settingsManager = SettingsManager.create(agentDir, agentDir, {
    projectTrusted: false,
  });
  const rolePrompts = ["Explorer role instruction.", "Child contract."];
  const loader = new DefaultResourceLoader({
    cwd: agentDir,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    appendSystemPromptOverride: (base) =>
      appendRoleSystemPrompts(base, rolePrompts),
  });
  await loader.reload();
  const model = getModel("openai", "gpt-4.1-mini");
  assert.ok(model);
  const { session } = await createAgentSession({
    cwd: agentDir,
    model,
    resourceLoader: loader,
    settingsManager,
    sessionManager: SessionManager.inMemory(agentDir),
    tools: ["read", "grep", "ls"],
  });
  t.after(() => session.dispose());
  await session.bindExtensions({ mode: "print" });

  assert.deepEqual(session.getActiveToolNames().sort(), ["grep", "ls", "read"]);
  assert.match(session.systemPrompt, /Existing operator instruction/);
  assert.match(session.systemPrompt, /Explorer role instruction/);
  assert.match(session.systemPrompt, /Child contract/);
});
