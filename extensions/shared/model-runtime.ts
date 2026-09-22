import { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** Parent ModelRuntime for child sessions. Prefer ctx.modelRuntime. */
export function resolveExtensionModelRuntime(source: {
  readonly modelRuntime?: ModelRuntime;
  readonly modelRegistry?: { readonly modelRuntime?: ModelRuntime };
}): ModelRuntime | undefined {
  return source.modelRuntime ?? source.modelRegistry?.modelRuntime;
}

export interface EnsureModelRuntimeSource {
  readonly modelRuntime?: ModelRuntime;
  readonly modelRegistry?: { readonly modelRuntime?: ModelRuntime };
  readonly createModelRuntime?: () => Promise<ModelRuntime>;
}

/**
 * Parent runtime when exposed, otherwise a freshly created one.
 * The factory override is a test seam; production uses ModelRuntime.create.
 */
export async function ensureExtensionModelRuntime(
  source: EnsureModelRuntimeSource,
): Promise<ModelRuntime> {
  const parent = source.modelRuntime ?? source.modelRegistry?.modelRuntime;
  if (parent) return parent;
  const create = source.createModelRuntime ?? (() => ModelRuntime.create());
  return create();
}
