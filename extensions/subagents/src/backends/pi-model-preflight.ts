import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

/** Resolve a Pi selection against the parent session's model registry. */
export function preflightPiModel(
  registry: Pick<
    ModelRegistry,
    "find" | "getAll" | "getAvailable" | "getProviderAuthStatus" | "getError"
  >,
  hint: string | undefined,
  inherited: { provider: string; id: string } | undefined,
) {
  if (registry.getError()) {
    throw Object.assign(
      new Error(
        "[MODEL_REGISTRY_UNAVAILABLE] The parent model registry reported a configuration error. Repair model configuration and refresh discovery before launching; raw configuration details are omitted.",
      ),
      { code: "MODEL_REGISTRY_UNAVAILABLE", alternatives: [] },
    );
  }
  const fail = (code: string, message: string) => {
    const alternatives = registry
      .getAvailable()
      .filter(
        (model) => registry.getProviderAuthStatus(model.provider).configured,
      )
      .map((model) => `${model.provider}/${model.id}`)
      .sort()
      .slice(0, 5);
    return Object.assign(
      new Error(
        `[${code}] ${message} ${alternatives.length ? `Registry alternatives with configured authentication (not proof of server entitlement): ${alternatives.join(", ")}.` : "No registry alternatives have configured authentication. Use Pi /login for the intended provider."} Select a provider-qualified model explicitly; do not retry guessed IDs.`,
      ),
      { code, alternatives },
    );
  };
  const authenticated = (
    model: NonNullable<ReturnType<typeof registry.find>>,
  ) => {
    if (!registry.getProviderAuthStatus(model.provider).configured) {
      throw fail(
        "MODEL_AUTH_UNAVAILABLE",
        `Authentication is not configured for "${model.provider}". The openai API route and openai-codex OAuth route use separate credentials; Codex CLI login is also separate from Pi.`,
      );
    }
    return model;
  };
  if (!hint) {
    if (!inherited)
      throw fail(
        "MODEL_REQUIRED",
        "No model was selected by the request, role, or parent.",
      );
    const found = registry.find(inherited.provider, inherited.id);
    if (found) return authenticated(found);
    throw fail(
      "MODEL_UNKNOWN",
      `Inherited model "${inherited.provider}/${inherited.id}" is absent from the parent registry.`,
    );
  }
  const slash = hint.indexOf("/");
  if (slash > 0) {
    const provider = hint.slice(0, slash);
    const id = hint.slice(slash + 1);
    const found = registry.find(provider, id);
    if (found) return authenticated(found);
    throw fail(
      "MODEL_UNKNOWN",
      `Unknown model "${hint}" in the parent registry.`,
    );
  }
  if (inherited) {
    const found = registry.find(inherited.provider, hint);
    if (found) return authenticated(found);
  }
  const matches = registry.getAll().filter((m) => m.id === hint);
  if (matches.length === 1) return authenticated(matches[0]);
  if (matches.length > 1) {
    throw new Error(
      `Model "${hint}" exists in multiple providers (${matches.map((m) => m.provider).join(", ")}). Use "provider/${hint}".`,
    );
  }
  throw fail(
    "MODEL_UNKNOWN",
    `Unknown model "${hint}" in the parent registry.`,
  );
}
