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
  assertRoleWorkingDirectory,
  appendRoleSystemPrompts,
  buildRoleSystemPrompts,
  findMissingRoleTools,
  loadRoleProfiles,
  parseRoleProfile,
  resolveRoleProfile,
  roleForSpawn,
} from "./src/roles.ts";

const validRole = `
name = "explorer"
description = "Read-only repository exploration"
developer_instructions = "Locate evidence and do not edit files."
tools = ["read", "grep", "find", "ls", "read"]
reasoning_effort = "high"
`;

test("parses and normalizes a role profile", () => {
  const role = parseRoleProfile(validRole, "/roles/explorer.toml");
  assert.equal(role.name, "explorer");
  assert.equal(role.reasoningEffort, "high");
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
  const roles = loadRoleProfiles(agentDir);
  assert.deepEqual([...roles.keys()], ["explorer", "worker"]);
  assert.equal(resolveRoleProfile(roles, "worker").name, "worker");

  fs.writeFileSync(path.join(rolesDir, "duplicate.toml"), validRole);
  assert.throws(() => loadRoleProfiles(agentDir), /Duplicate subagent role/);
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
  const roles = loadRoleProfiles(agentDir);
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
