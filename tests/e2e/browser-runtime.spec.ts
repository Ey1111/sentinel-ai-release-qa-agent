import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BrowserRuntime } from "../../packages/browser-runtime/src";
import { createTaskForgeFixedSpec } from "../../apps/worker/src/specs/taskforge";

test("fixed runtime spec completes TaskForge in a real isolated browser", async () => {
  test.setTimeout(60_000);
  const artifactRoot = await mkdtemp(join(tmpdir(), "sentinel-taskforge-runtime-"));
  try {
    const spec = createTaskForgeFixedSpec({ runId: "taskforge-runtime-e2e", targetUrl: "http://127.0.0.1:4174" });
    const result = await new BrowserRuntime({ artifactRoot, headless: true }).run(spec);
    expect(result.status).toBe("PASSED");
    expect(result.steps.every((step) => step.status === "PASSED")).toBe(true);
    expect(result.steps.find((step) => step.id === "verify-renamed-project")?.observation?.visibleText).toContain("Sentinel Release Gate");
    const runState = JSON.parse(await readFile(join(artifactRoot, "runs", spec.runId, "run.json"), "utf8"));
    expect(runState.status).toBe("PASSED");
    expect(runState.steps.find((step: { id: string }) => step.id === "fill-password").action.value).toBe("[REDACTED]");
    const manifest = JSON.parse(await readFile(join(artifactRoot, "runs", spec.runId, "manifest.json"), "utf8"));
    expect(manifest.artifacts.some((entry: { key: string }) => entry.key === "screenshots/taskforge-complete.png")).toBe(true);
    expect(manifest.artifacts.some((entry: { key: string }) => entry.key === "screenshots/000-navigate.png")).toBe(false);
    expect(manifest.artifacts.some((entry: { key: string }) => entry.key === "evidence/000-navigate-screenshot-suppressed.json")).toBe(true);
    const files = await readdir(join(artifactRoot, "runs", spec.runId), { recursive: true });
    const persistedText = (await Promise.all(files.filter((file) => file.endsWith(".json")).map((file) => readFile(join(artifactRoot, "runs", spec.runId, file), "utf8")))).join("\n");
    expect(persistedText).not.toContain("sentinel-demo");
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});
