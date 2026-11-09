import { describe, expect, it } from "vitest";
import { MockLLMProvider } from "@sentinel/llm";
import type { AssertionResult, Evidence } from "@sentinel/contracts";
import { BugReporterTask, classifyFailure } from "./index";

const assertion: AssertionResult = {
  schemaVersion: "1",
  status: "FAIL",
  expected: "Project Alpha is visible",
  actual: "No projects yet",
  confidence: 0.98,
  evidenceIds: ["visible"],
  reason: "The expected project is absent",
};

const evidence: Evidence[] = [{
  schemaVersion: "1",
  id: "visible",
  runId: "run-1",
  stepId: "step-1",
  type: "VISIBLE_TEXT",
  content: "No projects yet",
  createdAt: "2026-08-31T00:00:00.000Z",
  redactionStatus: "REDACTED",
}];

const reportFixture = {
  schemaVersion: "1" as const,
  title: "Created project is missing",
  summary: "The project creation flow ended without a visible project row.",
  category: "FUNCTIONAL" as const,
  severity: "HIGH" as const,
  classification: "REAL_BUG" as const,
  stepsToReproduce: ["Open the project form", "Create Project Alpha"],
  expected: assertion.expected,
  actual: assertion.actual,
  evidenceIds: ["visible"],
  confidence: 0.94,
};

describe("BugReporterTask", () => {
  it("generates a draft grounded in stored reproduction receipts", async () => {
    const reporter = new BugReporterTask(new MockLLMProvider([reportFixture]));
    const result = await reporter.generate({
      runId: "run-1",
      stepId: "step-1",
      testGoal: "Create Project Alpha",
      assertion,
      evidence,
      reproductionSteps: reportFixture.stepsToReproduce,
      failureSignals: {},
    });
    expect(result).toMatchObject({ status: "DRAFT", report: reportFixture, provenance: { isMock: true, promptId: "bug-reporter.v1" } });
  });

  it("overrides a product-bug classification when execution evidence shows automation failure", async () => {
    const reporter = new BugReporterTask(new MockLLMProvider([reportFixture]));
    const result = await reporter.generate({
      runId: "run-1",
      stepId: "step-1",
      testGoal: "Create Project Alpha",
      assertion,
      evidence,
      reproductionSteps: reportFixture.stepsToReproduce,
      failureSignals: { automationError: true },
    });
    expect(result.report).toMatchObject({ classification: "AUTOMATION_ERROR", category: "AUTOMATION" });
  });

  it("does not let the LLM invent an automation classification without a deterministic signal", async () => {
    const reporter = new BugReporterTask(new MockLLMProvider([{ ...reportFixture, classification: "AUTOMATION_ERROR" }]));
    const result = await reporter.generate({
      runId: "run-1",
      stepId: "step-1",
      testGoal: "Create Project Alpha",
      assertion,
      evidence,
      reproductionSteps: reportFixture.stepsToReproduce,
      failureSignals: {},
    });
    expect(result.report).toMatchObject({ classification: "REAL_BUG", category: "FUNCTIONAL" });
  });

  it("rejects model-authored reproduction steps that differ from stored receipts", async () => {
    const reporter = new BugReporterTask(new MockLLMProvider([{ ...reportFixture, stepsToReproduce: ["Invent a different action"] }]));
    await expect(reporter.generate({
      runId: "run-1",
      stepId: "step-1",
      testGoal: "Create Project Alpha",
      assertion,
      evidence,
      reproductionSteps: reportFixture.stepsToReproduce,
      failureSignals: {},
    })).rejects.toThrow("reproduction steps must match stored action receipts");
  });

  it("does not create a report for a non-failed assertion", async () => {
    const reporter = new BugReporterTask(new MockLLMProvider([]));
    await expect(reporter.generate({
      runId: "run-1",
      stepId: "step-1",
      testGoal: "Create Project Alpha",
      assertion: { ...assertion, status: "UNCERTAIN" },
      evidence,
      reproductionSteps: reportFixture.stepsToReproduce,
      failureSignals: {},
    })).rejects.toThrow("requires a failed assertion");
  });
});

describe("classifyFailure", () => {
  it.each([
    [{ environmentError: true }, "ENVIRONMENT_ERROR", "ENVIRONMENT"],
    [{ automationError: true }, "AUTOMATION_ERROR", "AUTOMATION"],
    [{ flaky: true }, "FLAKY", "UNKNOWN"],
    [{ coreNetworkFailure: true }, "REAL_BUG", "NETWORK"],
    [{}, "REAL_BUG", "UNKNOWN"],
  ] as const)("maps correlated signals without asking an LLM", (signals, classification, category) => {
    expect(classifyFailure(assertion, signals)).toEqual({ classification, category });
  });
});
