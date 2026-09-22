import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  ensureExtensionModelRuntime,
  resolveExtensionModelRuntime,
} from "./model-runtime.ts";

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

test("ensureExtensionModelRuntime prefers the parent runtime without creating", async () => {
  const modelRuntime = runtime("parent");
  assert.equal(
    await ensureExtensionModelRuntime({
      modelRuntime,
      createModelRuntime: () => {
        throw new Error("must not create when the parent provides a runtime");
      },
    }),
    modelRuntime,
  );
});

test("ensureExtensionModelRuntime creates a fresh runtime when the parent exposes none", async () => {
  const fresh = runtime("fresh");
  let calls = 0;
  assert.equal(
    await ensureExtensionModelRuntime({
      createModelRuntime: () => {
        calls++;
        return Promise.resolve(fresh);
      },
    }),
    fresh,
  );
  assert.equal(calls, 1);
});

test("ensureExtensionModelRuntime propagates creation failures", async () => {
  await assert.rejects(
    ensureExtensionModelRuntime({
      createModelRuntime: () => Promise.reject(new Error("no auth on file")),
    }),
    /no auth on file/,
  );
});
