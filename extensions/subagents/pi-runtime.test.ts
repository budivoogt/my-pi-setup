import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { applyPiServiceTierToAgent } from "./src/backends/pi.ts";

function fakeAgent() {
  const calls: Array<{
    provider: string;
    options: Record<string, unknown> | undefined;
  }> = [];
  const agent = {
    streamFunction(
      model: { provider: string },
      _context: unknown,
      options?: Record<string, unknown>,
    ) {
      calls.push({ provider: model.provider, options });
      return "stream";
    },
  } as unknown as AgentSession["agent"];
  return { agent, calls };
}

test("fast Codex requests wrap streamFunction with priority", () => {
  const { agent, calls } = fakeAgent();
  applyPiServiceTierToAgent(agent, "fast");
  const result = agent.streamFunction(
    { provider: "openai-codex" } as Parameters<
      AgentSession["agent"]["streamFunction"]
    >[0],
    { messages: [] } as Parameters<AgentSession["agent"]["streamFunction"]>[1],
    { temperature: 0 } as Parameters<
      AgentSession["agent"]["streamFunction"]
    >[2],
  );
  assert.equal(result, "stream");
  assert.deepEqual(calls, [
    {
      provider: "openai-codex",
      options: { temperature: 0, serviceTier: "priority" },
    },
  ]);
});

test("fast wrapping leaves non-Codex providers unchanged", () => {
  const { agent, calls } = fakeAgent();
  applyPiServiceTierToAgent(agent, "fast");
  agent.streamFunction(
    { provider: "xai" } as Parameters<
      AgentSession["agent"]["streamFunction"]
    >[0],
    { messages: [] } as Parameters<AgentSession["agent"]["streamFunction"]>[1],
    { temperature: 0 } as Parameters<
      AgentSession["agent"]["streamFunction"]
    >[2],
  );
  assert.deepEqual(calls, [{ provider: "xai", options: { temperature: 0 } }]);
});

test("omitted service tier leaves streamFunction unwrapped", () => {
  const { agent, calls } = fakeAgent();
  const original = agent.streamFunction;
  applyPiServiceTierToAgent(agent, undefined);
  assert.equal(agent.streamFunction, original);
  agent.streamFunction(
    { provider: "openai-codex" } as Parameters<
      AgentSession["agent"]["streamFunction"]
    >[0],
    { messages: [] } as Parameters<AgentSession["agent"]["streamFunction"]>[1],
    { temperature: 0 } as Parameters<
      AgentSession["agent"]["streamFunction"]
    >[2],
  );
  assert.deepEqual(calls, [
    { provider: "openai-codex", options: { temperature: 0 } },
  ]);
});
