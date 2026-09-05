import assert from "node:assert/strict";
import test from "node:test";
import type { Model } from "@earendil-works/pi-ai";
import { preflightPiModel } from "./src/backends/pi-model-preflight.ts";

function model(
  provider: string,
  id = "review-model",
): Model<"openai-responses"> {
  return {
    provider,
    id,
    name: id,
    api: "openai-responses",
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 10_000,
  };
}

function registry(
  models = [model("openai"), model("openai-codex")],
  authenticated = ["openai-codex"],
) {
  return {
    find: (provider: string, id: string) =>
      models.find((entry) => entry.provider === provider && entry.id === id),
    getAll: () => models,
    getAvailable: () =>
      models.filter((entry) => authenticated.includes(entry.provider)),
    getProviderAuthStatus: (provider: string) => ({
      configured: authenticated.includes(provider),
    }),
    getError: (): string | undefined => undefined,
  };
}

const inherited = { provider: "openai-codex", id: "review-model" };

test("a valid provider-qualified selection is preserved regardless of catalog order or parent provider", () => {
  const intended = model("openai-codex");
  for (const models of [
    [model("openai"), intended],
    [intended, model("openai")],
  ]) {
    assert.equal(
      preflightPiModel(registry(models), "openai-codex/review-model", {
        provider: "openai",
        id: "review-model",
      }),
      intended,
    );
  }
});

test("an omitted selection inherits exactly the parent model", () => {
  const intended = model("openai-codex");
  assert.equal(
    preflightPiModel(registry([intended]), undefined, inherited),
    intended,
  );
});

test("a bare ID keeps the inherited provider even when another provider has auth", () => {
  assert.throws(
    () =>
      preflightPiModel(registry(), "review-model", {
        provider: "openai",
        id: "review-model",
      }),
    { code: "MODEL_AUTH_UNAVAILABLE" },
  );
});

test("a bare ID resolves on the inherited provider or a unique registered provider", () => {
  const intended = model("openai-codex");
  assert.equal(
    preflightPiModel(
      registry([intended, model("openai")]),
      "review-model",
      inherited,
    ),
    intended,
  );
  assert.equal(
    preflightPiModel(registry([intended]), "review-model", undefined),
    intended,
  );
});

test("a bare ID shared by providers requires a qualified selection", () => {
  assert.throws(
    () => preflightPiModel(registry(), "review-model", undefined),
    /multiple providers.*openai.*openai-codex/,
  );
});

test("provider-qualified model IDs can contain slashes", () => {
  const intended = model("openai-codex", "team/review-model");
  assert.equal(
    preflightPiModel(
      registry([intended]),
      "openai-codex/team/review-model",
      inherited,
    ),
    intended,
  );
});

test("an unknown bare model never selects a fuzzy or default alternative", () => {
  assert.throws(() => preflightPiModel(registry(), "review", inherited), {
    code: "MODEL_UNKNOWN",
  });
});

test("no authenticated alternatives gives a login action instead of invented models", () => {
  assert.throws(
    () =>
      preflightPiModel(
        registry(undefined, []),
        "openai/review-model",
        inherited,
      ),
    { code: "MODEL_AUTH_UNAVAILABLE", alternatives: [] },
  );
});

test("auth failure offers only registered, authenticated alternatives without changing the selection", () => {
  assert.throws(
    () => preflightPiModel(registry(), "openai/review-model", inherited),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        (error as Error & { code?: string }).code,
        "MODEL_AUTH_UNAVAILABLE",
      );
      assert.match(error.message, /openai-codex\/review-model/);
      assert.match(error.message, /not.*entitlement/i);
      return true;
    },
  );
});

test("a missing inherited model cannot fall through to an SDK default", () => {
  assert.throws(
    () =>
      preflightPiModel(registry(), undefined, {
        ...inherited,
        id: "removed-model",
      }),
    { code: "MODEL_UNKNOWN" },
  );
});

test("unknown explicit selection returns a structured rejection with verified alternatives", () => {
  assert.throws(
    () => preflightPiModel(registry(), "openai/removed-model", inherited),
    {
      code: "MODEL_UNKNOWN",
      alternatives: ["openai-codex/review-model"],
    },
  );
});

test("missing selection cannot launch an unvalidated SDK default", () => {
  assert.throws(() => preflightPiModel(registry(), undefined, undefined), {
    code: "MODEL_REQUIRED",
  });
});

test("catalog errors fail closed without exposing raw configuration errors", () => {
  const broken = { ...registry(), getError: () => "private-config-detail" };
  assert.throws(
    () => preflightPiModel(broken, "openai-codex/review-model", inherited),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        (error as Error & { code?: string }).code,
        "MODEL_REGISTRY_UNAVAILABLE",
      );
      assert.doesNotMatch(error.message, /private-config-detail/);
      return true;
    },
  );
});

test("missing OpenAI API auth rejects the explicit route even when Codex OAuth is available", () => {
  assert.throws(
    () => preflightPiModel(registry(), "openai/review-model", inherited),
    /auth.*openai|openai.*auth/i,
  );
});
