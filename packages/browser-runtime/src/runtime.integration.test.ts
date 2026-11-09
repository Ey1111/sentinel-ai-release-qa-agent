import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BrowserRuntime, InteractiveBrowserSession, type FixedTestSpec } from "./index";

let server: Server;
let origin = "";
const roots: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "http://example.com/outside" });
      response.end();
      return;
    }
    if (request.url?.startsWith("/api/project")) {
      response.writeHead(201, { "content-type": "application/json" });
      response.end('{"ok":true}');
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><html><head><title>Runtime fixture</title></head><body>
      <label for="project-name">Project name</label><input id="project-name" />
      <button id="create">Create project</button><p id="result">No project</p>
      <script>document.querySelector('#create').addEventListener('click', async () => {
        console.error('password=topsecret');
        await fetch('/api/project?token=network-secret', { method: 'POST' });
        document.querySelector('#result').textContent = document.querySelector('#project-name').value;
      });</script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not bind");
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
afterAll(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

function successSpec(runId: string): FixedTestSpec {
  return {
    runId,
    name: "fixed browser runtime smoke",
    allowedOrigins: [origin],
    allowLocalhost: true,
    timeoutMs: 2_000,
    steps: [
      { id: "navigate", action: { type: "navigate", url: origin } },
      { id: "fill", action: { type: "fill", target: { by: "label", value: "Project name" }, value: "Release QA" } },
      { id: "click", action: { type: "click", target: { by: "role", role: "button", name: "Create project" } } },
      { id: "observe", action: { type: "snapshot" } },
      { id: "capture", action: { type: "screenshot", name: "completed" } },
    ],
  };
}

describe("BrowserRuntime with real Chromium", () => {
  it("executes a fixed spec and persists step-correlated evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-runtime-"));
    roots.push(root);
    const result = await new BrowserRuntime({ artifactRoot: root, headless: true }).run(successSpec("run-success"));
    expect(result.status).toBe("PASSED");
    expect(result.steps.map((step) => step.status)).toEqual(["PASSED", "PASSED", "PASSED", "PASSED", "PASSED"]);
    const runState = JSON.parse(await readFile(join(root, "runs", "run-success", "run.json"), "utf8"));
    expect(runState.status).toBe("PASSED");
    expect(runState.steps).toHaveLength(5);
    const manifest = JSON.parse(await readFile(join(root, "runs", "run-success", "manifest.json"), "utf8"));
    expect(manifest.artifacts.some((entry: { key: string }) => entry.key === "screenshots/completed.png")).toBe(true);
    expect(manifest.artifacts.some((entry: { key: string }) => entry.key.startsWith("console/click"))).toBe(true);
    expect(manifest.artifacts.some((entry: { key: string }) => entry.key.startsWith("network/click"))).toBe(true);
    const consoleArtifact = manifest.artifacts.find((entry: { key: string }) => entry.key.startsWith("console/click"));
    const consoleText = await readFile(join(root, "runs", "run-success", consoleArtifact.key), "utf8");
    expect(consoleText).toContain("password=[REDACTED]");
    expect(consoleText).not.toContain("topsecret");
    const networkArtifact = manifest.artifacts.find((entry: { key: string }) => entry.key.startsWith("network/click"));
    const networkText = await readFile(join(root, "runs", "run-success", networkArtifact.key), "utf8");
    expect(networkText).toContain("token=[REDACTED]");
    expect(networkText).not.toContain("network-secret");
  });

  it("starts each run with an isolated browser context", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-runtime-"));
    roots.push(root);
    const runtime = new BrowserRuntime({ artifactRoot: root, headless: true });
    const first = successSpec("run-isolation-1");
    first.steps.splice(1, 0, { id: "set-name", action: { type: "fill", target: { by: "label", value: "Project name" }, value: "Private run state" } });
    await runtime.run(first);
    const second = await runtime.run({ ...successSpec("run-isolation-2"), steps: [
      { id: "navigate", action: { type: "navigate", url: origin } },
      { id: "observe", action: { type: "snapshot" } },
    ] });
    expect(second.steps[1]?.observation?.visibleText).toContain("No project");
    expect(second.steps[1]?.observation?.visibleText).not.toContain("Private run state");
  });

  it("persists a timeout as a failed step and skips remaining actions", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-runtime-"));
    roots.push(root);
    const spec: FixedTestSpec = { ...successSpec("run-timeout"), timeoutMs: 1_000, steps: [
      { id: "navigate", action: { type: "navigate", url: origin } },
      { id: "missing", action: { type: "click", target: { by: "role", role: "button", name: "Does not exist" } } },
      { id: "never", action: { type: "snapshot" } },
    ] };
    const result = await new BrowserRuntime({ artifactRoot: root, headless: true }).run(spec);
    expect(result.status).toBe("FAILED");
    expect(result.steps[0]?.error).toBeUndefined();
    expect(result.steps[0]).toMatchObject({ status: "PASSED" });
    expect(result.steps.map((step) => step.status)).toEqual(["PASSED", "FAILED", "SKIPPED"]);
    expect(result.steps[1]?.error?.code).toBe("TIMEOUT");
  });

  it("classifies a redirect outside the allowlist as a policy violation", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-runtime-"));
    roots.push(root);
    const spec: FixedTestSpec = { ...successSpec("run-blocked-redirect"), steps: [
      { id: "redirect", action: { type: "navigate", url: `${origin}/redirect` } },
    ] };
    const result = await new BrowserRuntime({ artifactRoot: root, headless: true }).run(spec);
    expect(result.status).toBe("FAILED");
    expect(result.steps[0]?.error?.code).toBe("POLICY_VIOLATION");
    expect(result.steps[0]?.error?.message).toContain("Origin is not allowlisted: http://example.com");
  });
});

describe("InteractiveBrowserSession with grounded element refs", () => {
  it("observes and executes against a real page without accepting selectors", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-session-"));
    roots.push(root);
    const session = new InteractiveBrowserSession({
      runId: "interactive-success",
      artifactRoot: root,
      allowedOrigins: [origin],
      allowLocalhost: true,
      timeoutMs: 2_000,
      headless: true,
    });
    await session.open();
    try {
      await session.execute({ stepId: "interactive-step", action: { type: "NAVIGATE", url: origin } });
      const observed = (await session.observe({ stepId: "interactive-step" })).observation;
      const textbox = observed.interactiveElements.find((element) => element.role === "textbox" && element.name === "Project name");
      const button = observed.interactiveElements.find((element) => element.role === "button" && element.name === "Create project");
      expect(textbox?.ref).toMatch(/^p\d+-o\d+-e\d+$/);
      expect(button?.ref).toMatch(/^p\d+-o\d+-e\d+$/);
      await session.execute({ stepId: "interactive-step", action: { type: "FILL", elementRef: textbox!.ref, value: "Release QA" } });
      await session.execute({ stepId: "interactive-step", action: { type: "CLICK", elementRef: button!.ref } });
      expect((await session.observe({ stepId: "interactive-step" })).observation.visibleText).toContain("Release QA");
    } finally {
      await session.close();
    }
  });

  it("rejects stale element refs after a new observation", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-session-"));
    roots.push(root);
    const session = new InteractiveBrowserSession({ runId: "interactive-stale", artifactRoot: root, allowedOrigins: [origin], allowLocalhost: true, timeoutMs: 2_000, headless: true });
    await session.open();
    try {
      await session.execute({ stepId: "stale-step", action: { type: "NAVIGATE", url: origin } });
      const first = (await session.observe({ stepId: "stale-step" })).observation;
      const oldRef = first.interactiveElements[0]!.ref;
      await session.observe({ stepId: "stale-step" });
      await expect(session.execute({ stepId: "stale-step", action: { type: "CLICK", elementRef: oldRef } })).rejects.toMatchObject({ code: "ACTION_FAILED" });
    } finally {
      await session.close();
    }
  });
});
