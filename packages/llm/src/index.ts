import { createHash } from "node:crypto";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import type { z } from "zod";

export type StructuredLLMRequest<T> = {
  promptId: string;
  schemaVersion: string;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
};

export type LLMCallMetadata = {
  provider: string;
  model: string;
  promptId: string;
  promptHash: string;
  schemaVersion: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostMicros: number | null;
  isMock: boolean;
};

export type LLMResult<T> = { output: T; metadata: LLMCallMetadata };

export interface LLMProvider {
  generateStructured<T>(request: StructuredLLMRequest<T>): Promise<LLMResult<T>>;
}

export class MockLLMProvider implements LLMProvider {
  private readonly fixtures: unknown[];

  constructor(fixtures: unknown[]) {
    this.fixtures = [...fixtures];
  }

  async generateStructured<T>(request: StructuredLLMRequest<T>): Promise<LLMResult<T>> {
    const fixture = this.fixtures.shift();
    if (fixture === undefined) throw new Error("MockLLMProvider has no remaining fixture output");
    const parsed = request.schema.safeParse(fixture);
    if (!parsed.success) throw new Error(`Structured output failed schema validation: ${parsed.error.message}`);
    return {
      output: parsed.data,
      metadata: {
        provider: "mock",
        model: "fixture",
        promptId: request.promptId,
        promptHash: promptHash(request),
        schemaVersion: request.schemaVersion,
        latencyMs: 0,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        estimatedCostMicros: null,
        isMock: true,
      },
    };
  }
}

type GatewayUsage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
};

type GatewayGenerationInput<T> = {
  model: string;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
};

type GatewayGenerator = <T>(input: GatewayGenerationInput<T>) => Promise<{ output: unknown; usage: GatewayUsage }>;

export class GatewayLLMProvider implements LLMProvider {
  private readonly model: string;
  private readonly generate: GatewayGenerator;
  private readonly now: () => number;
  private readonly providerName: string;

  constructor(options: { model?: string; generate?: GatewayGenerator; now?: () => number; providerName?: string } = {}) {
    this.providerName = options.providerName ?? "vercel-ai-gateway";
    this.model = options.model ?? process.env.SENTINEL_LLM_MODEL ?? "deepseek/deepseek-v4-flash-0731";
    this.generate = options.generate ?? generateWithAiSdk;
    this.now = options.now ?? Date.now;
  }

  async generateStructured<T>(request: StructuredLLMRequest<T>): Promise<LLMResult<T>> {
    const startedAt = this.now();
    const generated = await this.generate({
      model: this.model,
      schema: request.schema,
      system: request.system,
      prompt: request.prompt,
    });
    const parsed = request.schema.safeParse(generated.output);
    if (!parsed.success) throw new Error(`Structured output failed schema validation: ${parsed.error.message}`);
    const finishedAt = this.now();
    return {
      output: parsed.data,
      metadata: {
        provider: this.providerName,
        model: this.model,
        promptId: request.promptId,
        promptHash: promptHash(request),
        schemaVersion: request.schemaVersion,
        latencyMs: Math.max(0, finishedAt - startedAt),
        inputTokens: generated.usage.inputTokens ?? null,
        outputTokens: generated.usage.outputTokens ?? null,
        totalTokens: generated.usage.totalTokens ?? null,
        estimatedCostMicros: null,
        isMock: false,
      },
    };
  }
}

async function generateWithAiSdk<T>(input: GatewayGenerationInput<T>): Promise<{ output: unknown; usage: GatewayUsage }> {
  const result = await generateText({
    model: input.model,
    system: input.system,
    prompt: input.prompt,
    reasoning: "none",
    output: Output.object({ schema: input.schema }),
  });
  return {
    output: result.output,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    },
  };
}

function deepSeekGenerator(apiKey: string | undefined): GatewayGenerator {
  return async <T>(input: GatewayGenerationInput<T>) => {
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");
    // DeepSeek has no native schema mode, so a response occasionally misses the schema; ask again rather than fail the Run.
    for (let attempt = 1; ; attempt += 1) {
      try {
        const result = await generateText({
          model: createDeepSeek({ apiKey })(input.model),
          maxRetries: 6,
          system: input.system,
          prompt: input.prompt,
          reasoning: "none",
          output: Output.object({ schema: input.schema }),
        });
        return {
          output: result.output,
          usage: {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.totalTokens,
          },
        };
      } catch (error) {
        if (attempt >= 3 || !NoObjectGeneratedError.isInstance(error)) throw error;
      }
    }
  };
}

/** Picks the provider from SENTINEL_LLM_PROVIDER. A missing key surfaces when the model is first called. */
export function createLLMProvider(env: NodeJS.ProcessEnv, options: { targetUrl?: string } = {}): LLMProvider {
  if (env.SENTINEL_LLM_PROVIDER === "mock") return new TaskForgeDemoProvider(options.targetUrl);
  if (env.SENTINEL_LLM_PROVIDER === "deepseek") {
    const configured = env.SENTINEL_LLM_MODEL;
    return new GatewayLLMProvider({
      providerName: "deepseek",
      // Gateway model names look like vendor/model and are not valid on DeepSeek's own API.
      model: configured && !configured.includes("/") ? configured : "deepseek-v4-flash",
      generate: deepSeekGenerator(env.DEEPSEEK_API_KEY),
    });
  }
  return new GatewayLLMProvider();
}

export { TaskForgeDemoProvider, TASKFORGE_DEMO_PLAN } from "./taskforge-demo";
import { TaskForgeDemoProvider } from "./taskforge-demo";

export function promptHash(request: Pick<StructuredLLMRequest<unknown>, "system" | "prompt">): string {
  return createHash("sha256").update(`${request.system}\n${request.prompt}`).digest("hex");
}
