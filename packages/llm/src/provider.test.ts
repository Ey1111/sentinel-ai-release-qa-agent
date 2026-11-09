import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLLMProvider, GatewayLLMProvider, MockLLMProvider, TaskForgeDemoProvider } from "./index";

describe("createLLMProvider", () => {
  const request = { promptId: "planner.v1", schemaVersion: "1", schema: z.object({}), system: "s", prompt: "p" };

  it("uses the labelled demo script only when mock is explicitly selected", () => {
    expect(createLLMProvider({ SENTINEL_LLM_PROVIDER: "mock" })).toBeInstanceOf(TaskForgeDemoProvider);
    expect(createLLMProvider({})).toBeInstanceOf(GatewayLLMProvider);
    expect(createLLMProvider({ SENTINEL_LLM_PROVIDER: "deepseek" })).toBeInstanceOf(GatewayLLMProvider);
  });

  it("fails clearly when the DeepSeek key is missing", async () => {
    await expect(createLLMProvider({ SENTINEL_LLM_PROVIDER: "deepseek" }).generateStructured(request)).rejects.toThrow("DEEPSEEK_API_KEY is not set");
  });
});

const answerSchema = z.object({ answer: z.string() }).strict();

describe("MockLLMProvider", () => {
  it("marks fixture output as mock and preserves prompt provenance", async () => {
    const provider = new MockLLMProvider([{ answer: "fixture" }]);

    const result = await provider.generateStructured({
      promptId: "planner.v1",
      schemaVersion: "1",
      schema: answerSchema,
      system: "Return a structured answer.",
      prompt: "Plan a run.",
    });

    expect(result.output).toEqual({ answer: "fixture" });
    expect(result.metadata).toMatchObject({
      provider: "mock",
      model: "fixture",
      promptId: "planner.v1",
      schemaVersion: "1",
      isMock: true,
      inputTokens: null,
      outputTokens: null,
      estimatedCostMicros: null,
    });
  });

  it("rejects a fixture that does not satisfy the requested schema", async () => {
    const provider = new MockLLMProvider([{ answer: 42 }]);

    await expect(provider.generateStructured({
      promptId: "planner.v1",
      schemaVersion: "1",
      schema: answerSchema,
      system: "Return a structured answer.",
      prompt: "Plan a run.",
    })).rejects.toThrow("Structured output failed schema validation");
  });
});

describe("GatewayLLMProvider", () => {
  it("records real-provider provenance and provider-reported token usage", async () => {
    const provider = new GatewayLLMProvider({
      model: "deepseek/deepseek-v4-flash-0731",
      now: (() => {
        const values = [100, 145];
        return () => values.shift() ?? 145;
      })(),
      generate: async () => ({
        output: { answer: "real-shaped" },
        usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
      }),
    });

    const result = await provider.generateStructured({
      promptId: "planner.v1",
      schemaVersion: "1",
      schema: answerSchema,
      system: "Return a structured answer.",
      prompt: "Plan a run.",
    });

    expect(result.output).toEqual({ answer: "real-shaped" });
    expect(result.metadata).toMatchObject({
      provider: "vercel-ai-gateway",
      model: "deepseek/deepseek-v4-flash-0731",
      promptId: "planner.v1",
      latencyMs: 45,
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 25,
      estimatedCostMicros: null,
      isMock: false,
    });
  });
});
