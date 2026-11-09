import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SentinelApiClient,
  createSentinelMcpServer,
  type JsonRecord,
  type SentinelGateway,
} from "./index";

const openServers: Array<ReturnType<typeof createSentinelMcpServer>> = [];
const openClients: Client[] = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

describe("Sentinel MCP server", () => {
  it("advertises only the six high-level workflow tools", async () => {
    const { client } = await connect(createGateway());

    const listed = await client.listTools();

    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "sentinel_create_run",
      "sentinel_generate_plan",
      "sentinel_get_run",
      "sentinel_approve_plan",
      "sentinel_start_run",
      "sentinel_get_bug",
    ]);
    expect(listed.tools.find((tool) => tool.name === "sentinel_get_run")?.annotations).toMatchObject({
      readOnlyHint: true,
    });
    expect(listed.tools.find((tool) => tool.name === "sentinel_start_run")?.annotations).toMatchObject({
      destructiveHint: true,
    });
  });

  it("validates and forwards create-run input as structured content", async () => {
    const createRun = vi.fn(async () => ({ id: "run-1", status: "CREATED" }));
    const { client } = await connect(createGateway({ createRun }));

    const result = await client.callTool({
      name: "sentinel_create_run",
      arguments: { targetUrl: "https://example.com", testGoal: "Verify login", maxSteps: 8 },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ id: "run-1", status: "CREATED" });
    expect(createRun).toHaveBeenCalledWith({ targetUrl: "https://example.com", testGoal: "Verify login", maxSteps: 8 });
  });

  it("refuses to start a stale or unapproved plan", async () => {
    const startRun = vi.fn(async () => ({ runId: "run-1", runStatus: "QUEUED" }));
    const gateway = createGateway({
      getPlan: vi.fn(async () => ({ runId: "run-1", status: "DRAFT", version: 3 })),
      startRun,
    });
    const { client } = await connect(gateway);

    const result = await client.callTool({
      name: "sentinel_start_run",
      arguments: { runId: "run-1", expectedPlanVersion: 3 },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("PLAN_NOT_APPROVED");
    expect(startRun).not.toHaveBeenCalled();
  });

  it("reports a started run as queued, never as finished", async () => {
    const gateway = createGateway({
      getPlan: vi.fn(async () => ({ runId: "run-1", status: "APPROVED", version: 3 })),
      startRun: vi.fn(async () => ({ runId: "run-1", runStatus: "QUEUED", planVersion: 3 })),
    });
    const { client } = await connect(gateway);

    const result = await client.callTool({ name: "sentinel_start_run", arguments: { runId: "run-1", expectedPlanVersion: 3 } });

    expect(result.structuredContent).toMatchObject({ runStatus: "QUEUED", executionFinished: false, result: "NOT_EVALUATED" });
  });

  it("aggregates run state without exposing a low-level browser tool", async () => {
    const getRun = vi.fn(async () => ({ id: "run-1", status: "COMPLETED", result: "FAIL" }));
    const { client } = await connect(createGateway({ getRun }));

    const result = await client.callTool({ name: "sentinel_get_run", arguments: { runId: "run-1" } });

    expect(result.structuredContent).toEqual({ id: "run-1", status: "COMPLETED", result: "FAIL" });
    expect(getRun).toHaveBeenCalledWith("run-1");
  });
});

describe("Sentinel API client", () => {
  it("uses the configured API boundary and preserves JSON responses", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "run-2", status: "CREATED" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    const api = new SentinelApiClient("http://127.0.0.1:4000/", fetcher);

    await expect(api.createRun({ targetUrl: "https://example.com", testGoal: "Test", maxSteps: 5 }))
      .resolves.toEqual({ id: "run-2", status: "CREATED" });
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:4000/api/v1/runs", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", testGoal: "Test", maxSteps: 5 }),
    }));
  });
});

async function connect(gateway: SentinelGateway) {
  const server = createSentinelMcpServer({ gateway });
  const client = new Client({ name: "sentinel-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  openServers.push(server);
  openClients.push(client);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function createGateway(overrides: Partial<SentinelGateway> = {}): SentinelGateway {
  const ok = async (): Promise<JsonRecord> => ({ ok: true });
  return {
    createRun: ok,
    generatePlan: ok,
    getRun: ok,
    getPlan: ok,
    approvePlan: ok,
    startRun: ok,
    getBug: ok,
    ...overrides,
  };
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return result.content.flatMap((item) => item.type === "text" ? [item.text] : []).join("\n");
}
