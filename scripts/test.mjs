import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

const liveTests = new Set(["claude.test.ts", "codex.test.ts"]);
const files = [];

for (const extension of readdirSync("extensions", { withFileTypes: true })) {
  if (!extension.isDirectory()) continue;
  const directory = path.join("extensions", extension.name);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      entry.name.endsWith(".test.ts") &&
      !liveTests.has(entry.name)
    ) {
      files.push(path.join(directory, entry.name));
    }
  }
}

files.sort();
const result = spawnSync(
  process.execPath,
  ["--test", "--experimental-strip-types", ...files],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
