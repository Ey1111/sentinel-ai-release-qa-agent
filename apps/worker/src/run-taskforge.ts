import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { BrowserRuntime } from "@sentinel/browser-runtime";
import { resolveArtifactRoot } from "./run-config";
import { createTaskForgeFixedSpec } from "./specs/taskforge";

const runId = process.env.SENTINEL_RUN_ID ?? randomUUID();
const targetUrl = process.env.TASKFORGE_URL ?? "http://127.0.0.1:4174";
const artifactRoot = resolveArtifactRoot(process.env.SENTINEL_ARTIFACT_ROOT);
const spec = createTaskForgeFixedSpec({
  runId,
  targetUrl,
  ...(process.env.TASKFORGE_EMAIL ? { email: process.env.TASKFORGE_EMAIL } : {}),
  ...(process.env.TASKFORGE_PASSWORD ? { password: process.env.TASKFORGE_PASSWORD } : {}),
});
const result = await new BrowserRuntime({ artifactRoot, headless: process.env.HEADED !== "1" }).run(spec);
process.stdout.write(`${JSON.stringify({ runId: result.runId, status: result.status, steps: result.steps.length, artifactDirectory: resolve(artifactRoot, "runs", result.runId) })}\n`);
if (result.status !== "PASSED") process.exitCode = 1;
