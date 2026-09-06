import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { resolveExtensionModelRuntime } from "./model-runtime.ts";

function runtime(tag: string) {
  return { tag } as unknown as ModelRuntime;
}

test("child sessions reuse the parent extension modelRuntime instance", () => {
  const modelRuntime = runtime("parent");
  const other = runtime("registry-other");
  assert.equal(
    resolveExtensionModelRuntime({
      modelRuntime,
      modelRegistry: { modelRuntime: other },
    }),
    modelRuntime,
  );
});

test("child sessions reuse ModelRegistry.modelRuntime when ctx.modelRuntime is absent", () => {
  const modelRuntime = runtime("registry");
  assert.equal(
    resolveExtensionModelRuntime({ modelRegistry: { modelRuntime } }),
    modelRuntime,
  );
});

test("missing parent runtime is reported as absent", () => {
  assert.equal(resolveExtensionModelRuntime({}), undefined);
  assert.equal(resolveExtensionModelRuntime({ modelRegistry: {} }), undefined);
});
