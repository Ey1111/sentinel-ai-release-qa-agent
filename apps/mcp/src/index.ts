import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

export type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type CreateRunInput = { targetUrl: string; testGoal: string; maxSteps: number };

export type SentinelGateway = {
  createRun(input: CreateRunInput): Promise<JsonRecord>;
  generatePlan(runId: string): Promise<JsonRecord>;
  getRun(runId: string): Promise<JsonRecord>;
  getPlan(runId: string): Promise<JsonRecord>;
  approvePlan(runId: string, version: number): Promise<JsonRecord>;
  startRun(runId: string): Promise<JsonRecord>;
  getBug(bugId: string): Promise<JsonRecord>;
};

export class SentinelApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`${code} (HTTP ${status})`);
    this.name = "SentinelApiError";
  }
}

export class SentinelApiClient implements SentinelGateway {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly fetcher: FetchLike = fetch) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("SENTINEL_API_BASE_URL must use http or https");
    }
    this.baseUrl = parsed.toString().replace(/\/$/, "");
  }

  createRun(input: CreateRunInput): Promise<JsonRecord> {
    return this.request("/api/v1/runs", { method: "POST", body: JSON.stringify(input) });
  }

  generatePlan(runId: string): Promise<JsonRecord> {
    return this.request(`/api/v1/runs/${encodeURIComponent(runId)}/plan`, { method: "POST" });
  }

  async getRun(runId: string): Promise<JsonRecord> {
    const id = encodeURIComponent(runId);
    const run = await this.request(`/api/v1/runs/${id}`);
    const [plan, steps, evidence, bugs] = await Promise.all([
      this.optionalRequest(`/api/v1/runs/${id}/plan`),
      this.request(`/api/v1/runs/${id}/steps`),
      this.request(`/api/v1/runs/${id}/evidence`),
      this.request(`/api/v1/runs/${id}/bugs`),
    ]);
    return {
      ...run,
      plan,
      steps: arrayProperty(steps, "steps"),
      evidence: arrayProperty(evidence, "evidence"),
      bugs: arrayProperty(bugs, "bugs"),
    };
  }

  getPlan(runId: string): Promise<JsonRecord> {
    return this.request(`/api/v1/runs/${encodeURIComponent(runId)}/plan`);
  }

  approvePlan(runId: string, version: number): Promise<JsonRecord> {
    return this.request(`/api/v1/runs/${encodeURIComponent(runId)}/plan/approve`, {
      method: "POST",
      body: JSON.stringify({ version }),
    });
  }

  startRun(runId: string): Promise<JsonRecord> {
    return this.request(`/api/v1/runs/${encodeURIComponent(runId)}/start`, { method: "POST" });
  }

  getBug(bugId: string): Promise<JsonRecord> {
    return this.request(`/api/v1/bugs/${encodeURIComponent(bugId)}`);
  }

  private async optionalRequest(path: string): Promise<JsonRecord | null> {
    try {
      return await this.request(path);
    } catch (error) {
      if (error instanceof SentinelApiError && error.status === 404) return null;
      throw error;
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<JsonRecord> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new SentinelApiError("SENTINEL_API_UNREACHABLE", 503);
    }

    const payload = await readJsonObject(response);
    if (!response.ok) {
      throw new SentinelApiError(stringProperty(payload, "error") ?? "SENTINEL_API_ERROR", response.status);
    }
    return payload;
  }
}

export function createSentinelMcpServer(options: { gateway: SentinelGateway }): McpServer {
  const server = new McpServer(
    { name: "sentinel-release-qa", version: "0.1.0" },
    {
      instructions: [
        "Sentinel performs evidence-bound release QA in a real browser.",
        "Create a run, generate and review its plan, obtain human approval, then start it.",
        "Never treat a queued run as passed. Use sentinel_get_run to read the final PASS, FAIL, or UNCERTAIN result.",
        "This server intentionally does not expose low-level browser actions or GitHub Issue creation.",
      ].join(" "),
    },
  );

  server.registerTool(
    "sentinel_create_run",
    {
      title: "Create Sentinel QA Run",
      description: "Create a release-QA run from a target HTTP(S) URL and natural-language test goal. This does not execute the browser.",
      inputSchema: z.object({
        targetUrl: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Target URL must use HTTP or HTTPS"),
        testGoal: z.string().trim().min(1).max(4_000),
        maxSteps: z.number().int().min(1).max(50).default(12),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => toolResult(() => options.gateway.createRun(input)),
  );

  server.registerTool(
    "sentinel_generate_plan",
    {
      title: "Generate Sentinel Test Plan",
      description: "Generate a new DRAFT structured test plan for an existing run. The plan must still be reviewed and approved.",
      inputSchema: z.object({ runId: identifier("runId") }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ runId }) => toolResult(() => options.gateway.generatePlan(runId)),
  );

  server.registerTool(
    "sentinel_get_run",
    {
      title: "Read Sentinel QA Run",
      description: "Read a run with its plan, step verdicts, evidence metadata, and bug summaries. status is QUEUED, RUNNING, COMPLETED, or FAILED once started; result stays NOT_EVALUATED until COMPLETED. It never operates the browser.",
      inputSchema: z.object({ runId: identifier("runId") }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ runId }) => toolResult(() => options.gateway.getRun(runId)),
  );

  server.registerTool(
    "sentinel_approve_plan",
    {
      title: "Approve Sentinel Test Plan",
      description: "Approve one exact test-plan version after human review. A stale version is rejected.",
      inputSchema: z.object({ runId: identifier("runId"), version: z.number().int().positive() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ runId, version }) => toolResult(() => options.gateway.approvePlan(runId, version)),
  );

  server.registerTool(
    "sentinel_start_run",
    {
      title: "Start Sentinel Browser QA",
      description: "Queue real browser execution for an already-approved exact plan version. Browser actions may change the target application.",
      inputSchema: z.object({ runId: identifier("runId"), expectedPlanVersion: z.number().int().positive() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ runId, expectedPlanVersion }) => toolResult(async () => {
      const plan = await options.gateway.getPlan(runId);
      if (plan.status !== "APPROVED") throw new SentinelToolError("PLAN_NOT_APPROVED");
      if (plan.version !== expectedPlanVersion) throw new SentinelToolError("PLAN_VERSION_CONFLICT");
      const started = await options.gateway.startRun(runId);
      return {
        ...started,
        executionFinished: false,
        result: "NOT_EVALUATED",
        message: "Queued only. No browser result exists yet. Poll sentinel_get_run until status is COMPLETED or FAILED.",
      };
    }),
  );

  server.registerTool(
    "sentinel_get_bug",
    {
      title: "Read Sentinel Bug Draft",
      description: "Read an evidence-bound DRAFT bug report and linked evidence metadata. This does not approve or create a GitHub Issue.",
      inputSchema: z.object({ bugId: identifier("bugId") }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ bugId }) => toolResult(() => options.gateway.getBug(bugId)),
  );

  return server;
}

class SentinelToolError extends Error {}

function identifier(name: string) {
  return z.string().trim().min(1, `${name} is required`).max(200);
}

async function toolResult(operation: () => Promise<JsonRecord>): Promise<CallToolResult> {
  try {
    const output = await operation();
    return {
      content: [{ type: "text", text: JSON.stringify(output) }],
      structuredContent: output,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SENTINEL_TOOL_FAILED";
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

async function readJsonObject(response: Response): Promise<JsonRecord> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new SentinelApiError("INVALID_API_RESPONSE", 502);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SentinelApiError("INVALID_API_RESPONSE", 502);
  }
  return value as JsonRecord;
}

function stringProperty(value: JsonRecord, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function arrayProperty(value: JsonRecord, key: string): unknown[] {
  return Array.isArray(value[key]) ? value[key] : [];
}
