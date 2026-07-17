import assert from "node:assert/strict";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packagePath = fileURLToPath(
  new URL("../../package.json", import.meta.url),
);

test("the root Pi package exposes the supported extensions and subagents skill", () => {
  const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
    keywords?: string[];
    pi?: Record<string, string[]>;
  };

  assert.ok(manifest.keywords?.includes("pi-package"));
  assert.deepEqual(manifest.pi, {
    extensions: [
      "./extensions/subagents/index.ts",
      "./extensions/background-terminals/index.ts",
    ],
    skills: ["./skills/subagents/SKILL.md"],
  });
});
