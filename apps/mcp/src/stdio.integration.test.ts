import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const openClients: Client[] = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
});

describe("Sentinel MCP stdio entrypoint", () => {
  it("negotiates with a real child process and lists Sentinel tools", async () => {
    const client = new Client({ name: "sentinel-stdio-smoke", version: "1.0.0" });
    openClients.push(client);
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/stdio.ts"],
      cwd: join(process.cwd(), "apps", "mcp"),
      stderr: "pipe",
    }));

    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name)).toContain("sentinel_create_run");
    expect(tools.tools.map((tool) => tool.name)).toContain("sentinel_start_run");
    expect(client.getInstructions()).toContain("real browser");
  });
});
