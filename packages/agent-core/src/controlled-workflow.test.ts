import { describe, expect, it } from "vitest";
import { MockLLMProvider } from "@sentinel/llm";
import { ControlledQaWorkflow, QaExecutionAgent, type QaBrowserTool } from "./index";

const plan = {
  schemaVersion: "1" as const,
  title: "Open project form",
  goal: "Open project form",
  assumptions: [],
  successCriteria: ["The form is visible"],
  steps: [{ id: "step-1", description: "Open project form", intent: "Reach the form", expectedState: "The form is visible", riskLevel: "LOW" as const, dependencies: [] }],
};

const observation = {
  url: "http://127.0.0.1:4174",
  title: "TaskForge",
  visibleText: "New project",
  ariaSnapshot: "- button \"New project\"",
  interactiveElements: [{ ref: "e1", role: "button", name: "New project" }],
};

const capture = { observation, evidence: [], observationHealthy: false, hardFailureEvidenceIds: [] };

describe("ControlledQaWorkflow", () => {
  it("executes only validated actions and records a mock-labelled trace", async () => {
    const browser: QaBrowserTool = {
      observe: async () => capture,
      execute: async ({ stepId, action }) => ({ stepId, action, pageUrl: observation.url, occurredAt: "2026-01-01T00:00:00.000Z" }),
    };
    const provider = new MockLLMProvider([
      { schemaVersion: "1", type: "ACTION", stepId: "step-1", action: { type: "CLICK", elementRef: "e1" }, conciseReason: "Open the form", confidence: 0.95 },
      { schemaVersion: "1", type: "FINISH", stepId: "step-1", expectedState: "The form is visible", conciseReason: "The requested interaction is complete", confidence: 0.8 },
    ]);
    const workflow = new ControlledQaWorkflow(new QaExecutionAgent(provider), browser);

    const result = await workflow.run({
      approvedPlan: plan,
      allowedOrigins: ["http://127.0.0.1:4174"],
      budgets: { maxActions: 4, maxRetriesPerStep: 1, maxLlmCalls: 4 },
    });

    expect(result.status).toBe("EXECUTION_FINISHED");
    expect(result.trace).toHaveLength(2);
    expect(result.trace[0]).toMatchObject({ decision: { type: "ACTION" }, provenance: { isMock: true }, receipt: { pageUrl: observation.url } });
    expect(result.trace[1]).toMatchObject({ decision: { type: "FINISH" }, provenance: { isMock: true } });
    expect(JSON.stringify(result)).not.toContain("PASS");
  });

  it("stops before exceeding the LLM call budget", async () => {
    const browser: QaBrowserTool = { observe: async () => capture, execute: async () => { throw new Error("should not execute"); } };
    const provider = new MockLLMProvider([{ schemaVersion: "1", type: "RETRY", stepId: "step-1", conciseReason: "Observe again", confidence: 0.4 }]);
    const workflow = new ControlledQaWorkflow(new QaExecutionAgent(provider), browser);
    const result = await workflow.run({ approvedPlan: plan, allowedOrigins: [observation.url], budgets: { maxActions: 2, maxRetriesPerStep: 2, maxLlmCalls: 1 } });
    expect(result).toMatchObject({ status: "BUDGET_EXHAUSTED", reason: "MAX_LLM_CALLS" });
  });
});
