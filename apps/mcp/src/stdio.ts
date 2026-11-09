#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { SentinelApiClient, createSentinelMcpServer } from "./index.js";

const baseUrl = process.env.SENTINEL_API_BASE_URL ?? "http://127.0.0.1:4000";

const handle = serveStdio(
  () => createSentinelMcpServer({ gateway: new SentinelApiClient(baseUrl) }),
  { onerror: (error) => process.stderr.write(`[sentinel-mcp] ${error.message}\n`) },
);

process.stderr.write(`[sentinel-mcp] connected to ${baseUrl}\n`);

async function shutdown() {
  await handle.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
