import { describe, expect, it } from "vitest";
import { MockLLMProvider } from "@sentinel/llm";
import type { Evidence, TestPlanStep } from "@sentinel/contracts";
import { ObserverAgent } from "./index";

const step: TestPlanStep = {
  id: "step-1",
  description: "Open the project workspace",
  intent: "Reach the projects page",
  expectedState: "The Projects workspace is visible",
  riskLevel: "LOW",
  dependencies: [],
  assertions: [
    { id: "projects-text", type: "VISIBLE_TEXT_CONTAINS", value: "Projects", required: true },
    { id: "workspace-path", type: "URL_PATH_EQUALS", value: "/workspace", required: true },
  ],
};

const observation = {
  url: "https://example.test/workspace",
  title: "Projects",
  visibleText: "Projects\nNo projects yet",
  ariaSnapshot: "- heading \"Projects\"",
  interactiveElements: [],
};

const evidence: Evidence[] = [
  { schemaVersion: "1", id: "visible", runId: "run-1", stepId: step.id, type: "VISIBLE_TEXT", content: observation.visibleText, createdAt: "2026-08-31T00:00:00.000Z", redactionStatus: "REDACTED" },
  { schemaVersion: "1", id: "dom", runId: "run-1", stepId: step.id, type: "DOM_STATE", content: observation.ariaSnapshot, createdAt: "2026-08-31T00:00:00.000Z", redactionStatus: "REDACTED" },
];

describe("ObserverAgent deterministic-first policy", () => {
  it("returns PASS without an LLM call when all required rules pass", async () => {
    const observer = new ObserverAgent(new MockLLMProvider([]), { minimumDecisiveConfidence: 0.7 });
    const result = await observer.evaluate({ runId: "run-1", step, observation, evidence, observationHealthy: true, hardFailureEvidenceIds: [] });
    expect(result).toMatchObject({ source: "DETERMINISTIC", assertion: { status: "PASS", expected: step.expectedState, confidence: 1 } });
  });

  it("returns evidence-bound FAIL without allowing an LLM override", async () => {
    const observer = new ObserverAgent(new MockLLMProvider([]), { minimumDecisiveConfidence: 0.7 });
    const result = await observer.evaluate({
      runId: "run-1",
      step,
      observation: { ...observation, visibleText: "Welcome", url: "https://example.test/login" },
      evidence,
      observationHealthy: true,
      hardFailureEvidenceIds: [],
    });
    expect(result).toMatchObject({ source: "DETERMINISTIC", assertion: { status: "FAIL", confidence: 1 } });
    expect(result.assertion.evidenceIds.length).toBeGreaterThan(0);
  });

  it("uses the Critic only for semantic outcomes and downgrades low confidence", async () => {
    const semanticStep = { ...step, assertions: undefined };
    const provider = new MockLLMProvider([{
      schemaVersion: "1",
      status: "PASS",
      expected: semanticStep.expectedState,
      actual: "A workspace-like page is visible",
      confidence: 0.45,
      evidenceIds: ["visible"],
      reason: "The layout appears related",
    }]);
    const result = await new ObserverAgent(provider, { minimumDecisiveConfidence: 0.7 }).evaluate({ runId: "run-1", step: semanticStep, observation, evidence, observationHealthy: true, hardFailureEvidenceIds: [] });
    expect(result).toMatchObject({ source: "CRITIC", assertion: { status: "UNCERTAIN", confidence: 0.45 }, provenance: { isMock: true, promptId: "critic.v1" } });
  });

  it("returns UNCERTAIN without calling the Critic when evidence capture is unhealthy", async () => {
    const observer = new ObserverAgent(new MockLLMProvider([]), { minimumDecisiveConfidence: 0.7 });
    const result = await observer.evaluate({ runId: "run-1", step, observation, evidence: [], observationHealthy: false, hardFailureEvidenceIds: [] });
    expect(result).toMatchObject({ source: "DETERMINISTIC", assertion: { status: "UNCERTAIN", confidence: 0, evidenceIds: [] } });
  });

  it("returns UNCERTAIN instead of crashing on a malformed observation URL", async () => {
    const observer = new ObserverAgent(new MockLLMProvider([]), { minimumDecisiveConfidence: 0.7 });
    const result = await observer.evaluate({
      runId: "run-1",
      step,
      observation: { ...observation, url: "not a valid URL" },
      evidence,
      observationHealthy: true,
      hardFailureEvidenceIds: [],
    });
    expect(result).toMatchObject({ source: "DETERMINISTIC", assertion: { status: "UNCERTAIN", confidence: 0 } });
  });
});
