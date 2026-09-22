import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { ALLOWED_CLAUDE_MODELS } from "./src/backends/claude.ts";
import { BUNDLED_ROLES_DIR, parseRoleProfile } from "./src/roles.ts";

test("Bundled roles only use allowed Claude models", () => {
  const allowed = new Set<string>(ALLOWED_CLAUDE_MODELS);
  const violations: string[] = [];
  for (const entry of readdirSync(BUNDLED_ROLES_DIR)) {
    if (!entry.endsWith(".toml")) continue;
    const sourcePath = path.join(BUNDLED_ROLES_DIR, entry);
    const profile = parseRoleProfile(
      readFileSync(sourcePath, "utf8"),
      sourcePath,
    );
    if (
      profile.claudeModel !== undefined &&
      !allowed.has(profile.claudeModel)
    ) {
      violations.push(`${profile.name}: ${profile.claudeModel}`);
    }
  }
  assert.deepEqual(violations, []);
});
