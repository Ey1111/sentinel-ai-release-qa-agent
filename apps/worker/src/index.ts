import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const workspaceEnv = resolve(import.meta.dirname, "../../../.env");
if (existsSync(workspaceEnv)) process.loadEnvFile(workspaceEnv);

const { createDatabase, PostgresRunStore } = await import("@sentinel/db");
const { createLLMProvider } = await import("@sentinel/llm");
const { secretsForRun } = await import("./test-secrets");
const { createHeartbeat } = await import("./heartbeat");
const { createRunExecutor } = await import("./run-executor");
const { resolveArtifactRoot } = await import("./run-config");
const { RunWorker } = await import("./worker-loop");

process.stdout.write(`${JSON.stringify(createHeartbeat())}\n`);

const databaseUrl = process.env.DATABASE_URL ?? "postgres://sentinel:sentinel@localhost:5432/sentinel";
const useDemoScript = process.env.SENTINEL_LLM_PROVIDER === "mock";
const { client } = createDatabase(databaseUrl);
const log = (message: string) => process.stdout.write(`[worker] ${message}\n`);
const worker = new RunWorker({
  store: new PostgresRunStore(client),
  workerId: `${hostname()}-${process.pid}`,
  log,
  execute: createRunExecutor({
    artifactRoot: resolveArtifactRoot(process.env.SENTINEL_ARTIFACT_ROOT),
    allowLocalhost: process.env.SENTINEL_ALLOW_LOCALHOST === "true",
    createProvider: (run) => createLLMProvider(process.env, { targetUrl: run.targetUrl }),
    secretsFor: (run) => secretsForRun(process.env, run.allowedOrigins),
  }),
});

let stopping = false;
const stop = () => { stopping = true; };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const pollMs = Number(process.env.SENTINEL_WORKER_POLL_MS ?? 1_000);
log(`polling every ${pollMs} ms (${useDemoScript ? "demo script, not a real model" : "real model"})`);
while (!stopping) {
  try {
    if (!(await worker.tick())) await sleep(pollMs);
  } catch (error) {
    log(`database unavailable, retrying: ${error instanceof Error ? error.message : "unknown error"}`);
    await sleep(Math.max(pollMs, 3_000));
  }
}
await client.end({ timeout: 5 });
