import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { InteractiveBrowserSession } from "./interactive-session";

let server: Server;
let origin = "";
const roots: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url?.startsWith("/server-error")) {
      response.writeHead(500, { "content-type": "application/javascript" });
      response.end("/* expected fixture failure */");
      return;
    }
    if (request.url === "/telemetry") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><title>Telemetry fixture</title>
        <script src="/server-error?token=network-secret"></script>
        <script src="http://example.com/blocked.js?token=request-secret"></script>
        <script>console.error("password=console-secret"); throw new Error("token=page-secret")</script>
        <main>Telemetry complete</main>`);
      return;
    }
    if (request.url === "/secret") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><title>Secret fixture</title>
        <label for="credential">Credential</label><input id="credential">
        <button onclick="document.querySelector('p').textContent = document.querySelector('input').value">Reveal</button>
        <p>Hidden</p>`);
      return;
    }
    if (request.url === "/detach") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><title>Detach fixture</title>
        <button onclick="document.querySelector('#target').remove()">Remove target</button>
        <button id="target">Target action</button>`);
      return;
    }
    if (request.url === "/canvas") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>Canvas fixture</title><canvas width=20 height=20></canvas><main>Inspectable text</main>");
      return;
    }
    if (request.url === "/noise-only") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<!doctype html><title>Noise fixture</title><script src="http://example.com/noise.js"></script><main>Ready</main>');
      return;
    }
    if (request.url === "/core-error") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<!doctype html><title>Core failure fixture</title><script src="/server-error"></script><main>Ready</main>');
      return;
    }
    if (request.url === "/slow") {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<!doctype html><title>Slow fixture</title><main>Ready</main>");
      }, 200);
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Evidence fixture</title><main>Release ready</main>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not bind");
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
afterAll(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

describe("InteractiveBrowserSession evidence capture", () => {
  it("rejects a concurrent observation without changing an in-flight action", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-interactive-concurrency-"));
    roots.push(root);
    const session = new InteractiveBrowserSession({
      runId: "run-concurrency",
      artifactRoot: root,
      allowedOrigins: [origin],
      allowLocalhost: true,
      timeoutMs: 2_000,
      headless: true,
    });
    await session.open();
    try {
      const navigating = session.execute({ stepId: "slow-step", action: { type: "NAVIGATE", url: `${origin}/slow` } });
      await expect(session.observe({ stepId: "other-step" })).rejects.toMatchObject({
        name: "InteractiveSessionBusyError",
        code: "SESSION_BUSY",
        runId: "run-concurrency",
      });
      await expect(navigating).resolves.toMatchObject({ stepId: "slow-step", pageUrl: `${origin}/slow` });
      const capture = await session.observe({ stepId: "slow-step" });
      expect(capture.observation.stepId).toBe("slow-step");
    } finally {
      await session.close();
    }
  });

  it("distinguishes core network failures from blocked third-party noise", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-interactive-network-scope-"));
    roots.push(root);
    const session = new InteractiveBrowserSession({
      runId: "run-network-scope",
      artifactRoot: root,
      allowedOrigins: [origin],
      allowLocalhost: true,
      timeoutMs: 2_000,
      headless: true,
    });
    await session.open();
    try {
      await session.execute({ stepId: "noise-step", action: { type: "NAVIGATE", url: `${origin}/noise-only` } });
      const noise = await session.observe({ stepId: "noise-step" });
      expect(noise.observation.networkFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "REQUEST_FAILED", isCore: false, url: "http://example.com/noise.js" }),
      ]));
      expect(noise.evidence.some((item) => item.type === "NETWORK_FAILURE")).toBe(true);
      expect(noise.hardFailureEvidenceIds).toEqual([]);
      expect(noise.failureSignals?.coreNetworkFailure).not.toBe(true);

      await session.execute({ stepId: "core-step", action: { type: "NAVIGATE", url: `${origin}/core-error` } });
      const core = await session.observe({ stepId: "core-step" });
      expect(core.observation.networkFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "HTTP_ERROR", status: 500, isCore: true, url: `${origin}/server-error` }),
      ]));
      const coreNetworkEvidence = core.evidence.find((item) => item.type === "NETWORK_FAILURE");
      expect(core.hardFailureEvidenceIds).toEqual([coreNetworkEvidence!.id]);
      expect(core.failureSignals).toMatchObject({ coreNetworkFailure: true });
    } finally {
      await session.close();
    }
  });

  it("suppresses screenshots when canvas content cannot be inspected for secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-interactive-canvas-"));
    roots.push(root);
    const session = new InteractiveBrowserSession({
      runId: "run-canvas",
      artifactRoot: root,
      allowedOrigins: [origin],
      allowLocalhost: true,
      timeoutMs: 2_000,
      headless: true,
    });
    await session.open();
    try {
      await session.execute({ stepId: "canvas-step", action: { type: "NAVIGATE", url: `${origin}/canvas` } });
      const capture = await session.observe({ stepId: "canvas-step", captureScreenshot: true });

      expect(capture.observation.screenshotId).toBeUndefined();
      expect(capture.evidence).toContainEqual(expect.objectContaining({
        type: "TRACE",
        content: "SCREENSHOT_SUPPRESSED_UNINSPECTABLE_MEDIA",
      }));
      expect(capture.evidence.some((item) => item.type === "SCREENSHOT")).toBe(false);
      const manifestText = await readFile(join(root, "runs", "run-canvas", "manifest.json"), "utf8");
      expect(manifestText).not.toMatch(/screenshots\/.+\.png/);
    } finally {
      await session.close();
    }
  });

  it("returns step-bound SCREENSHOT evidence from an explicit safe screenshot action", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-interactive-screenshot-action-"));
    roots.push(root);
    const session = new InteractiveBrowserSession({
      runId: "run-screenshot-action",
      artifactRoot: root,
      allowedOrigins: [origin],
      allowLocalhost: true,
      timeoutMs: 2_000,
      headless: true,
      now: () => new Date("2026-08-31T08:00:00.000Z"),
    });
    await session.open();
    try {
      await session.execute({ stepId: "proof-step", action: { type: "NAVIGATE", url: origin } });
      const receipt = await session.execute({ stepId: "proof-step", action: { type: "SCREENSHOT", reason: "Release proof" } });

      expect(receipt.evidence).toEqual([
        expect.objectContaining({
          type: "SCREENSHOT",
          runId: "run-screenshot-action",
          stepId: "proof-step",
          artifactPath: "screenshots/0002-proof-step.png",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]);
      expect(receipt.evidenceKeys).toEqual(["screenshots/0002-proof-step.png"]);
      const manifest = JSON.parse(await readFile(join(root, "runs", "run-screenshot-action", "manifest.json"), "utf8")) as {
        artifacts: Array<{ key: string; stepId?: string }>;
      };
      expect(manifest.artifacts).toContainEqual(expect.objectContaining({ key: "screenshots/0002-proof-step.png", stepId: "proof-step" }));
    } finally {
      await session.close();
    }
  });

  it("suppresses an explicit screenshot action when a resolved secret is visible", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-interactive-secret-action-"));
    roots.push(root);
    const session = new InteractiveBrowserSession({
      runId: "run-secret-action",
      artifactRoot: root,
      allowedOrigins: [origin],
      allowLocalhost: true,
      timeoutMs: 2_000,
      headless: true,
      resolveSecret: async () => "s3cr3t-value",
    });
    await session.open();
    try {
      await session.execute({ stepId: "secret-action-step", action: { type: "NAVIGATE", url: `${origin}/secret` } });
      const initial = await session.observe({ stepId: "secret-action-step" });
      const textbox = initial.observation.interactiveElements.find((element) => element.role === "textbox");
      const button = initial.observation.interactiveElements.find((element) => element.role === "button");
      await session.execute({ stepId: "secret-action-step", action: { type: "FILL", elementRef: textbox!.ref, value: { secretRef: "TEST_CREDENTIAL" } } });
      await session.execute({ stepId: "secret-action-step", action: { type: "CLICK", elementRef: button!.ref } });

      const receipt = await session.execute({
        stepId: "secret-action-step",
        action: { type: "SCREENSHOT", reason: "token=reason-secret" },
      });

      expect(receipt.evidence).toEqual([
        expect.objectContaining({ type: "TRACE", content: "SCREENSHOT_SUPPRESSED_SECRET_VISIBLE", artifactPath: expect.stringMatching(/^evidence\//) }),
      ]);
      expect(receipt.evidenceKeys).toEqual([receipt.evidence[0]!.artifactPath]);
      const manifestText = await readFile(join(root, "runs", "run-secret-action", "manifest.json"), "utf8");
      const serialized = `${JSON.stringify(receipt)}\n${manifestText}`;
      expect(serialized).not.toContain("s3cr3t-value");
      expect(serialized).not.toContain("reason-secret");
      expect(manifestText).not.toMatch(/screenshots\/.+\.png/);
    } finally {
      await session.close();
    }
  });

  it("persists a selector-safe PLAYWRIGHT_ERROR before rejecting a failed action", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-interactive-action-error-"));
    roots.push(root);
    const session = new InteractiveBrowserSession({
      runId: "run-action-error",
      artifactRoot: root,
      allowedOrigins: [origin],
      allowLocalhost: true,
      timeoutMs: 2_000,
      headless: true,
      now: () => new Date("2026-08-31T08:00:00.000Z"),
    });
    await session.open();
    try {
      await session.execute({ stepId: "automation-step", action: { type: "NAVIGATE", url: `${origin}/detach` } });
      const capture = await session.observe({ stepId: "automation-step" });
      const remove = capture.observation.interactiveElements.find((element) => element.name === "Remove target");
      const target = capture.observation.interactiveElements.find((element) => element.name === "Target action");
      await session.execute({ stepId: "automation-step", action: { type: "CLICK", elementRef: remove!.ref } });

      let caught: unknown;
      try {
        await session.execute({ stepId: "automation-step", action: { type: "CLICK", elementRef: target!.ref } });
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        name: "InteractiveActionError",
        code: "TIMEOUT",
        runId: "run-action-error",
        stepId: "automation-step",
        message: "Browser CLICK timed out after 2000 ms.",
      });
      const errorEvidence = (caught as { evidence: Array<{ type: string; artifactPath?: string }> }).evidence;
      expect(errorEvidence).toHaveLength(1);
      expect(errorEvidence[0]).toMatchObject({ type: "PLAYWRIGHT_ERROR", artifactPath: expect.stringMatching(/^traces\//) });
      const serialized = JSON.stringify(caught);
      expect(serialized).not.toContain("locator(");
      expect(serialized).not.toContain("button, a[href]");
      expect(serialized).not.toContain("#target");
      const artifact = await readFile(join(root, "runs", "run-action-error", errorEvidence[0]!.artifactPath!), "utf8");
      expect(artifact).toContain("Browser CLICK timed out after 2000 ms.");
      expect(artifact).not.toContain("locator(");
      expect(artifact).not.toContain("#target");
    } finally {
      await session.close();
    }
  });

  it("redacts resolved secrets and suppresses an unsafe screenshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-interactive-secret-"));
    roots.push(root);
    const session = new InteractiveBrowserSession({
      runId: "run-secret",
      artifactRoot: root,
      allowedOrigins: [origin],
      allowLocalhost: true,
      timeoutMs: 2_000,
      headless: true,
      resolveSecret: async () => "s3cr3t-value",
    });
    await session.open();
    try {
      await session.execute({ stepId: "secret-step", action: { type: "NAVIGATE", url: `${origin}/secret` } });
      const initial = await session.observe({ stepId: "secret-step" });
      const textbox = initial.observation.interactiveElements.find((element) => element.role === "textbox");
      const button = initial.observation.interactiveElements.find((element) => element.role === "button");
      const fillReceipt = await session.execute({
        stepId: "secret-step",
        action: { type: "FILL", elementRef: textbox!.ref, value: { secretRef: "TEST_CREDENTIAL" } },
      });
      await session.execute({ stepId: "secret-step", action: { type: "CLICK", elementRef: button!.ref } });
      const capture = await session.observe({ stepId: "secret-step", captureScreenshot: true });

      expect(capture.observation.visibleText).toContain("[REDACTED]");
      expect(capture.observation.screenshotId).toBeUndefined();
      expect(capture.evidence.some((item) => item.type === "SCREENSHOT")).toBe(false);
      const suppression = capture.evidence.find((item) => item.type === "TRACE" && item.content?.includes("SCREENSHOT_SUPPRESSED_SECRET_VISIBLE"));
      expect(suppression).toMatchObject({ runId: "run-secret", stepId: "secret-step", redactionStatus: "REDACTED" });
      expect(suppression?.artifactPath).toMatch(/^evidence\//);

      const manifestText = await readFile(join(root, "runs", "run-secret", "manifest.json"), "utf8");
      const serialized = `${JSON.stringify(fillReceipt)}\n${JSON.stringify(capture)}\n${manifestText}`;
      expect(serialized).not.toContain("s3cr3t-value");
      expect(manifestText).not.toMatch(/screenshots\/.+\.png/);
    } finally {
      await session.close();
    }
  });

  it("drains each telemetry event once from only its originating step", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-interactive-step-events-"));
    roots.push(root);
    const session = new InteractiveBrowserSession({
      runId: "run-step-events",
      artifactRoot: root,
      allowedOrigins: [origin],
      allowLocalhost: true,
      timeoutMs: 2_000,
      headless: true,
    });
    await session.open();
    try {
      await session.execute({ stepId: "step-a", action: { type: "NAVIGATE", url: `${origin}/telemetry` } });
      await session.execute({ stepId: "step-b", action: { type: "NAVIGATE", url: origin } });

      const stepB = await session.observe({ stepId: "step-b" });
      expect(stepB.observation.consoleErrors).toEqual([]);
      expect(stepB.observation.networkFailures).toEqual([]);
      expect(stepB.observation.browserErrors).toEqual([]);

      const stepA = await session.observe({ stepId: "step-a" });
      expect(stepA.observation.consoleErrors.length).toBeGreaterThan(0);
      expect(stepA.observation.networkFailures.length).toBeGreaterThan(0);
      expect(stepA.observation.browserErrors.length).toBeGreaterThan(0);

      const stepAAgain = await session.observe({ stepId: "step-a" });
      expect(stepAAgain.observation.consoleErrors).toEqual([]);
      expect(stepAAgain.observation.networkFailures).toEqual([]);
      expect(stepAAgain.observation.browserErrors).toEqual([]);
      expect(stepAAgain.evidence.map((item) => item.type)).not.toEqual(expect.arrayContaining([
        "CONSOLE_ERROR",
        "NETWORK_FAILURE",
        "PLAYWRIGHT_ERROR",
      ]));
    } finally {
      await session.close();
    }
  });

  it("captures redacted console, network, and page errors for their step", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-interactive-telemetry-"));
    roots.push(root);
    const session = new InteractiveBrowserSession({
      runId: "run-telemetry",
      artifactRoot: root,
      allowedOrigins: [origin],
      allowLocalhost: true,
      timeoutMs: 2_000,
      headless: true,
      now: () => new Date("2026-08-31T08:00:00.000Z"),
    });
    await session.open();
    try {
      await session.execute({ stepId: "telemetry-step", action: { type: "NAVIGATE", url: `${origin}/telemetry` } });
      const capture = await session.observe({ stepId: "telemetry-step" });

      expect(capture.observation.consoleErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ text: "password=[REDACTED]" }),
      ]));
      expect(capture.observation.networkFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "HTTP_ERROR", status: 500, url: `${origin}/server-error?token=[REDACTED]` }),
        expect.objectContaining({ kind: "REQUEST_FAILED", failure: expect.stringContaining("net::ERR_BLOCKED_BY_CLIENT") }),
      ]));
      expect(capture.observation.browserErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "PAGE_ERROR", message: "token=[REDACTED]" }),
      ]));
      expect(capture.evidence.map((item) => item.type)).toEqual(expect.arrayContaining([
        "CONSOLE_ERROR",
        "NETWORK_FAILURE",
        "PLAYWRIGHT_ERROR",
      ]));
      const hardFailures = capture.evidence.filter((item) => item.type === "NETWORK_FAILURE" || item.type === "PLAYWRIGHT_ERROR");
      expect(capture.hardFailureEvidenceIds).toEqual(hardFailures.map((item) => item.id));
      const serialized = JSON.stringify(capture);
      expect(serialized).not.toContain("console-secret");
      expect(serialized).not.toContain("network-secret");
      expect(serialized).not.toContain("request-secret");
      expect(serialized).not.toContain("page-secret");
      expect(capture.evidence.every((item) => item.runId === "run-telemetry" && item.stepId === "telemetry-step")).toBe(true);
    } finally {
      await session.close();
    }
  });

  it("binds an action receipt to the explicit run step", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-interactive-receipt-"));
    roots.push(root);
    const session = new InteractiveBrowserSession({
      runId: "run-receipt",
      artifactRoot: root,
      allowedOrigins: [origin],
      allowLocalhost: true,
      timeoutMs: 2_000,
      headless: true,
      now: () => new Date("2026-08-31T08:00:00.000Z"),
    });
    await session.open();
    try {
      await expect(session.execute({ stepId: "navigate-step", action: { type: "NAVIGATE", url: origin } })).resolves.toMatchObject({
        runId: "run-receipt",
        stepId: "navigate-step",
        action: { type: "NAVIGATE", url: origin },
        pageUrl: `${origin}/`,
        occurredAt: "2026-08-31T08:00:00.000Z",
      });
    } finally {
      await session.close();
    }
  });

  it("binds DOM, visible text, and a screenshot to the requested run step", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-interactive-evidence-"));
    roots.push(root);
    const session = new InteractiveBrowserSession({
      runId: "run-evidence",
      artifactRoot: root,
      allowedOrigins: [origin],
      allowLocalhost: true,
      timeoutMs: 2_000,
      headless: true,
      now: () => new Date("2026-08-31T08:00:00.000Z"),
    });
    await session.open();
    try {
      await session.execute({ stepId: "navigate-release", action: { type: "NAVIGATE", url: origin } });
      const capture = await session.observe({ stepId: "assert-release", captureScreenshot: true });

      expect(capture.observation).toMatchObject({
        schemaVersion: "1",
        runId: "run-evidence",
        stepId: "assert-release",
        title: "Evidence fixture",
        visibleText: "Release ready",
        capturedAt: "2026-08-31T08:00:00.000Z",
      });
      expect(capture.observation.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(capture.observationHealthy).toBe(true);
      expect(capture.hardFailureEvidenceIds).toEqual([]);

      const byType = new Map(capture.evidence.map((item) => [item.type, item]));
      expect([...byType.keys()]).toEqual(expect.arrayContaining(["DOM_STATE", "VISIBLE_TEXT", "SCREENSHOT"]));
      expect(capture.observation.screenshotId).toBe(byType.get("SCREENSHOT")?.id);
      for (const evidence of capture.evidence) {
        expect(evidence).toMatchObject({ runId: "run-evidence", stepId: "assert-release" });
      }

      const manifest = JSON.parse(await readFile(join(root, "runs", "run-evidence", "manifest.json"), "utf8")) as {
        artifacts: Array<{ key: string; stepId?: string; sha256: string }>;
      };
      for (const evidence of capture.evidence.filter((item) => item.artifactPath)) {
        expect(manifest.artifacts).toContainEqual(expect.objectContaining({
          key: evidence.artifactPath,
          stepId: "assert-release",
          sha256: evidence.sha256,
        }));
      }
    } finally {
      await session.close();
    }
  });
});
