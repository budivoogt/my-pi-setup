import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** Parent ModelRuntime for child sessions. Prefer ctx.modelRuntime. */
export function resolveExtensionModelRuntime(source: {
  readonly modelRuntime?: ModelRuntime;
  readonly modelRegistry?: { readonly modelRuntime?: ModelRuntime };
}): ModelRuntime | undefined {
  return source.modelRuntime ?? source.modelRegistry?.modelRuntime;
}
