import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BugReporterTask, ControlledQaWorkflow, ObserverAgent, QaExecutionAgent } from "@sentinel/agent-core";
import { InteractiveBrowserSession } from "@sentinel/browser-runtime";
import { MockLLMProvider } from "@sentinel/llm";
import { SessionQaBrowserTool } from "./session-adapter";

let server: Server;
let origin = "";

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>QA fixture</title><button onclick=\"document.querySelector('p').textContent='Done'\">Start check</button><p>Waiting</p>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not bind");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

describe("worker-controlled QA execution", () => {
  it("turns grounded mock decisions into real Playwright actions", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "sentinel-agent-run-"));
    const session = new InteractiveBrowserSession({ runId: "agent-real-browser", artifactRoot, allowedOrigins: [origin], allowLocalhost: true, timeoutMs: 2_000, headless: true });
    await session.open();
    try {
      const provider = new MockLLMProvider([
        { schemaVersion: "1", type: "ACTION", stepId: "step-1", action: { type: "NAVIGATE", url: origin }, conciseReason: "Open the approved target", confidence: 1 },
        { schemaVersion: "1", type: "ACTION", stepId: "step-1", action: { type: "CLICK", elementRef: "p1-o2-e1" }, conciseReason: "Start the check", confidence: 1 },
        { schemaVersion: "1", type: "FINISH", stepId: "step-1", expectedState: "The fixture displays Done", conciseReason: "The interaction sequence is complete", confidence: 0.9 },
      ]);
      const workflow = new ControlledQaWorkflow(new QaExecutionAgent(provider), new SessionQaBrowserTool(session));
      const result = await workflow.run({
        approvedPlan: {
          schemaVersion: "1",
          title: "Run fixture action",
          goal: "Start the check",
          assumptions: [],
          successCriteria: ["The page displays Done"],
          steps: [{ id: "step-1", description: "Start the check", intent: "Exercise the fixture", expectedState: "The fixture displays Done", riskLevel: "LOW", dependencies: [] }],
        },
        allowedOrigins: [origin],
        budgets: { maxActions: 3, maxRetriesPerStep: 1, maxLlmCalls: 4 },
      });
      expect(result).toMatchObject({ status: "EXECUTION_FINISHED", actionsExecuted: 2, llmCalls: 3 });
      expect(result.trace.every((entry) => entry.provenance.isMock)).toBe(true);
      expect((await session.observe({ stepId: "step-1" })).observation.visibleText).toContain("Done");
    } finally {
      await session.close();
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("turns a real final browser capture into an evidence-bound FAIL and DRAFT Bug Report", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "sentinel-phase4-browser-run-"));
    const runId = "phase4-real-browser";
    const stepId = "step-1";
    const visibleEvidenceId = `evidence-${createHash("sha256")
      .update(JSON.stringify([runId, stepId, "p1-o3", "VISIBLE_TEXT"]))
      .digest("hex")
      .slice(0, 24)}`;
    const actual = `URL: ${origin}/; Title: QA fixture; Visible: Start check Waiting`;
    const session = new InteractiveBrowserSession({ runId, artifactRoot, allowedOrigins: [origin], allowLocalhost: true, timeoutMs: 2_000, headless: true });
    await session.open();
    try {
      const workflow = new ControlledQaWorkflow(
        new QaExecutionAgent(new MockLLMProvider([
          { schemaVersion: "1", type: "ACTION", stepId, action: { type: "NAVIGATE", url: origin }, conciseReason: "Open the approved target", confidence: 1 },
          { schemaVersion: "1", type: "FINISH", stepId, expectedState: "The fixture displays Done", conciseReason: "Evaluate the final state", confidence: 1 },
        ])),
        new SessionQaBrowserTool(session),
        {
          observer: new ObserverAgent(new MockLLMProvider([]), { minimumDecisiveConfidence: 0.7 }),
          bugReporter: new BugReporterTask(new MockLLMProvider([{
            schemaVersion: "1",
            title: "Release check remains waiting",
            summary: "The fixture did not reach its expected completed state.",
            category: "FUNCTIONAL",
            severity: "HIGH",
            classification: "REAL_BUG",
            stepsToReproduce: [`Navigate to ${origin}/`],
            expected: "The fixture displays Done",
            actual,
            evidenceIds: [visibleEvidenceId],
            confidence: 0.98,
          }])),
        },
      );
      const result = await workflow.run({
        runId,
        testGoal: "Verify the fixture completes",
        approvedPlan: {
          schemaVersion: "1",
          title: "Verify fixture completion",
          goal: "Verify the fixture completes",
          assumptions: [],
          successCriteria: ["The fixture displays Done"],
          steps: [{
            id: stepId,
            description: "Inspect the release result",
            intent: "Confirm completion",
            expectedState: "The fixture displays Done",
            riskLevel: "LOW",
            dependencies: [],
            assertions: [{ id: "done-text", type: "VISIBLE_TEXT_CONTAINS", value: "Done", required: true }],
          }],
        },
        allowedOrigins: [origin],
        budgets: { maxActions: 3, maxRetriesPerStep: 1, maxLlmCalls: 4 },
      });

      expect(result).toMatchObject({
        status: "FAIL",
        assertions: [{ stepId, source: "DETERMINISTIC", assertion: { status: "FAIL", actual, evidenceIds: expect.arrayContaining([visibleEvidenceId]) } }],
        bugDrafts: [{ stepId, status: "DRAFT", report: { title: "Release check remains waiting", classification: "REAL_BUG", evidenceIds: [visibleEvidenceId] } }],
        actionsExecuted: 1,
        llmCalls: 3,
      });
      expect(result.evidence.map((item) => item.type)).toEqual(expect.arrayContaining(["DOM_STATE", "VISIBLE_TEXT", "SCREENSHOT"]));
      expect(result.evidence.every((item) => item.runId === runId && item.stepId === stepId)).toBe(true);
    } finally {
      await session.close();
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });
});
