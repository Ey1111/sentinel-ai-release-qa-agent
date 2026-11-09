import { describe, expect, it } from "vitest";
import { MockLLMProvider } from "@sentinel/llm";
import type { Evidence, TestPlan } from "@sentinel/contracts";
import {
  BugReporterTask,
  ControlledQaWorkflow,
  ObserverAgent,
  QaExecutionAgent,
  type QaBrowserTool,
  type QaPageObservation,
} from "./index";

const runId = "run-phase-4";
const stepId = "step-1";
const plan: TestPlan = {
  schemaVersion: "1",
  title: "Run release check",
  goal: "Verify the release status",
  assumptions: [],
  successCriteria: ["The page displays Done"],
  steps: [{
    id: stepId,
    description: "Run the release check",
    intent: "Verify the result",
    expectedState: "The page displays Done",
    riskLevel: "LOW",
    dependencies: [],
    assertions: [{ id: "done-text", type: "VISIBLE_TEXT_CONTAINS", value: "Done", required: true }],
  }],
};

const observation = (visibleText: string): QaPageObservation => ({
  url: "https://release.example.test/check",
  title: "Release check",
  visibleText,
  ariaSnapshot: `- paragraph "${visibleText}"`,
  interactiveElements: [{ ref: "e1", role: "button", name: "Run check" }],
});

const evidence = (id: string, type: Evidence["type"], content: string): Evidence => ({
  schemaVersion: "1",
  id,
  runId,
  stepId,
  type,
  content,
  createdAt: "2026-08-31T00:00:00.000Z",
  redactionStatus: "REDACTED",
});

const capture = (visibleText: string, items: Evidence[]) => ({
  observation: observation(visibleText),
  evidence: items,
  observationHealthy: true,
  hardFailureEvidenceIds: [],
});

describe("ControlledQaWorkflow Phase 4 evaluation", () => {
  it("returns PASS only after the deterministic Observer binds the final state to evidence", async () => {
    const screenshotRequests: Array<boolean | undefined> = [];
    const browser: QaBrowserTool = {
      observe: async ({ stepId: requestedStepId, captureScreenshot }) => {
        expect(requestedStepId).toBe(stepId);
        screenshotRequests.push(captureScreenshot);
        return capture("Done", [evidence("visible-pass", "VISIBLE_TEXT", "Done")]);
      },
      execute: async () => { throw new Error("No action expected"); },
    };
    const workflow = new ControlledQaWorkflow(
      new QaExecutionAgent(new MockLLMProvider([{ schemaVersion: "1", type: "FINISH", stepId, expectedState: plan.steps[0]!.expectedState, conciseReason: "The interaction is complete", confidence: 1 }])),
      browser,
      {
        observer: new ObserverAgent(new MockLLMProvider([]), { minimumDecisiveConfidence: 0.7 }),
        bugReporter: new BugReporterTask(new MockLLMProvider([])),
      },
    );

    const result = await workflow.run({
      runId,
      testGoal: plan.goal,
      approvedPlan: plan,
      allowedOrigins: ["https://release.example.test"],
      budgets: { maxActions: 2, maxRetriesPerStep: 1, maxLlmCalls: 4 },
    });

    expect(result).toMatchObject({
      status: "PASS",
      assertions: [{ stepId, source: "DETERMINISTIC", assertion: { status: "PASS", evidenceIds: ["visible-pass"] } }],
      bugDrafts: [],
    });
    expect(screenshotRequests).toEqual([undefined, true]);
  });

  it("preserves low-confidence semantic results as UNCERTAIN and creates no Bug Draft", async () => {
    const semanticPlan: TestPlan = { ...plan, steps: [{ ...plan.steps[0]!, assertions: undefined }] };
    const browser: QaBrowserTool = {
      observe: async () => capture("A release-like page", [evidence("visible-uncertain", "VISIBLE_TEXT", "A release-like page")]),
      execute: async () => { throw new Error("No action expected"); },
    };
    const observerOutput = {
      schemaVersion: "1",
      status: "PASS",
      expected: semanticPlan.steps[0]!.expectedState,
      actual: "A release-like page is visible",
      confidence: 0.45,
      evidenceIds: ["visible-uncertain"],
      reason: "The page appears related",
    };
    const workflow = new ControlledQaWorkflow(
      new QaExecutionAgent(new MockLLMProvider([{ schemaVersion: "1", type: "FINISH", stepId, expectedState: semanticPlan.steps[0]!.expectedState, conciseReason: "Ready for evaluation", confidence: 1 }])),
      browser,
      {
        observer: new ObserverAgent(new MockLLMProvider([observerOutput]), { minimumDecisiveConfidence: 0.7 }),
        bugReporter: new BugReporterTask(new MockLLMProvider([])),
      },
    );

    const result = await workflow.run({
      runId,
      testGoal: semanticPlan.goal,
      approvedPlan: semanticPlan,
      allowedOrigins: ["https://release.example.test"],
      budgets: { maxActions: 2, maxRetriesPerStep: 1, maxLlmCalls: 4 },
    });

    expect(result).toMatchObject({ status: "UNCERTAIN", assertions: [{ assertion: { status: "UNCERTAIN" }, source: "CRITIC" }], bugDrafts: [] });
    expect(result.llmCalls).toBe(2);
  });

  it("rejects cross-run evidence contamination and downgrades the step to UNCERTAIN", async () => {
    const rogue = { ...evidence("rogue", "VISIBLE_TEXT", "Done"), runId: "another-run" };
    const browser: QaBrowserTool = {
      observe: async () => capture("Done", [evidence("visible-safe", "VISIBLE_TEXT", "Done"), rogue]),
      execute: async () => { throw new Error("No action expected"); },
    };
    const workflow = new ControlledQaWorkflow(
      new QaExecutionAgent(new MockLLMProvider([{ schemaVersion: "1", type: "FINISH", stepId, expectedState: plan.steps[0]!.expectedState, conciseReason: "Ready for evaluation", confidence: 1 }])),
      browser,
      {
        observer: new ObserverAgent(new MockLLMProvider([]), { minimumDecisiveConfidence: 0.7 }),
        bugReporter: new BugReporterTask(new MockLLMProvider([])),
      },
    );

    const result = await workflow.run({
      runId,
      testGoal: plan.goal,
      approvedPlan: plan,
      allowedOrigins: ["https://release.example.test"],
      budgets: { maxActions: 2, maxRetriesPerStep: 1, maxLlmCalls: 4 },
    });

    expect(result).toMatchObject({ status: "UNCERTAIN", assertions: [{ assertion: { status: "UNCERTAIN" } }], bugDrafts: [] });
    expect(result.evidence.map((item) => item.id)).toEqual(["visible-safe"]);
  });

  it("creates an evidence-bound DRAFT Bug Report from stored action receipts when a step FAILS", async () => {
    let observed = 0;
    const browser: QaBrowserTool = {
      observe: async () => {
        observed += 1;
        return observed === 1
          ? capture("Run check", [evidence("visible-before", "VISIBLE_TEXT", "Run check")])
          : capture("Still waiting", [evidence("visible-fail", "VISIBLE_TEXT", "Still waiting")]);
      },
      execute: async ({ stepId: requestedStepId, action }) => ({ action, stepId: requestedStepId, pageUrl: observation("Still waiting").url, occurredAt: "2026-08-31T00:00:01.000Z" }),
    };
    const failedActual = "URL: https://release.example.test/check; Title: Release check; Visible: Still waiting";
    const bugFixture = {
      schemaVersion: "1",
      title: "Release check never completes",
      summary: "The release check remains waiting after it is started.",
      category: "FUNCTIONAL",
      severity: "HIGH",
      classification: "REAL_BUG",
      stepsToReproduce: ["Click element e1"],
      expected: plan.steps[0]!.expectedState,
      actual: failedActual,
      evidenceIds: ["visible-fail"],
      confidence: 0.97,
    };
    const workflow = new ControlledQaWorkflow(
      new QaExecutionAgent(new MockLLMProvider([
        { schemaVersion: "1", type: "ACTION", stepId, action: { type: "CLICK", elementRef: "e1" }, conciseReason: "Run the check", confidence: 1 },
        { schemaVersion: "1", type: "FINISH", stepId, expectedState: plan.steps[0]!.expectedState, conciseReason: "Evaluate the result", confidence: 1 },
      ])),
      browser,
      {
        observer: new ObserverAgent(new MockLLMProvider([]), { minimumDecisiveConfidence: 0.7 }),
        bugReporter: new BugReporterTask(new MockLLMProvider([bugFixture])),
      },
    );

    const result = await workflow.run({
      runId,
      testGoal: plan.goal,
      approvedPlan: plan,
      allowedOrigins: ["https://release.example.test"],
      budgets: { maxActions: 2, maxRetriesPerStep: 1, maxLlmCalls: 4 },
    });

    expect(result).toMatchObject({
      status: "FAIL",
      assertions: [{ assertion: { status: "FAIL", expected: plan.steps[0]!.expectedState, actual: failedActual, evidenceIds: ["visible-fail"] } }],
      bugDrafts: [{ stepId, status: "DRAFT", report: { title: bugFixture.title, classification: "REAL_BUG", evidenceIds: ["visible-fail"] } }],
    });
    expect(result.llmCalls).toBe(3);
    expect(result.evidence.map((item) => item.id)).toEqual(["visible-before", "visible-fail"]);
  });

  it("does not turn a browser execution error into a product Bug Report", async () => {
    const actionFailureEvidence = evidence("action-failure", "PLAYWRIGHT_ERROR", "Browser CLICK failed.");
    const browser: QaBrowserTool = {
      observe: async () => capture("Run check", [evidence("visible-before", "VISIBLE_TEXT", "Run check")]),
      execute: async () => {
        throw Object.assign(new Error("safe browser action failure"), { evidence: [actionFailureEvidence] });
      },
    };
    const workflow = new ControlledQaWorkflow(
      new QaExecutionAgent(new MockLLMProvider([{ schemaVersion: "1", type: "ACTION", stepId, action: { type: "CLICK", elementRef: "e1" }, conciseReason: "Run the check", confidence: 1 }])),
      browser,
      {
        observer: new ObserverAgent(new MockLLMProvider([]), { minimumDecisiveConfidence: 0.7 }),
        bugReporter: new BugReporterTask(new MockLLMProvider([])),
      },
    );

    const result = await workflow.run({
      runId,
      testGoal: plan.goal,
      approvedPlan: plan,
      allowedOrigins: ["https://release.example.test"],
      budgets: { maxActions: 2, maxRetriesPerStep: 1, maxLlmCalls: 4 },
    });

    expect(result).toMatchObject({ status: "AGENT_FAILED", reason: "BROWSER_ACTION_FAILED", bugDrafts: [] });
    expect(result.evidence.map((item) => item.id)).toEqual(["visible-before", "action-failure"]);
    expect(result.trace[0]?.evidenceIds).toEqual(["visible-before", "action-failure"]);
  });
});
