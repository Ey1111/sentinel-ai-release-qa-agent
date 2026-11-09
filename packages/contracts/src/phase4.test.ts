import { describe, expect, it } from "vitest";
import { validateAssertionResult, validateBugReport, validateEvidence } from "./index";

const evidence = {
  schemaVersion: "1" as const,
  id: "evidence-visible-text",
  runId: "run-1",
  stepId: "step-1",
  type: "VISIBLE_TEXT" as const,
  content: "Project Alpha is visible",
  createdAt: "2026-08-31T00:00:00.000Z",
  redactionStatus: "REDACTED" as const,
};

describe("Phase 4 evidence contract", () => {
  it("rejects evidence that has neither content nor an artifact", () => {
    const result = validateEvidence({ ...evidence, content: undefined });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected empty evidence to be rejected");
    expect(result.errors).toContain("Evidence must contain content or an artifact path.");
  });

  it("requires screenshot evidence to reference a persisted artifact", () => {
    const result = validateEvidence({ ...evidence, type: "SCREENSHOT" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an unpersisted screenshot to be rejected");
    expect(result.errors).toContain("Screenshot evidence requires an artifact path.");
  });

  it("requires trace evidence to reference a persisted artifact", () => {
    const result = validateEvidence({ ...evidence, type: "TRACE" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an unpersisted trace to be rejected");
    expect(result.errors).toContain("Trace evidence requires an artifact path.");
  });

  it("requires every artifact reference to carry its immutable hash", () => {
    const result = validateEvidence({ ...evidence, artifactPath: "observations/step-1.json" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an unhashed artifact to be rejected");
    expect(result.errors).toContain("Artifact evidence requires a SHA-256 hash.");
  });
});

describe("Phase 4 assertion contract", () => {
  it("allows an evidence-free UNCERTAIN result when capture is unavailable", () => {
    const result = validateAssertionResult({
      schemaVersion: "1",
      status: "UNCERTAIN",
      expected: "Project Alpha is visible",
      actual: "Observation capture was unavailable",
      confidence: 0,
      evidenceIds: [],
      reason: "No trustworthy observation was captured",
    }, { expected: "Project Alpha is visible", availableEvidenceIds: [], minimumDecisiveConfidence: 0.7 });

    expect(result).toMatchObject({ ok: true, assertion: { status: "UNCERTAIN", evidenceIds: [] } });
  });

  it("rejects a decisive result that cites no evidence", () => {
    const result = validateAssertionResult({
      schemaVersion: "1",
      status: "PASS",
      expected: "Project Alpha is visible",
      actual: "Project Alpha is visible",
      confidence: 1,
      evidenceIds: [],
      reason: "The expected text is visible",
    }, { expected: "Project Alpha is visible", availableEvidenceIds: [], minimumDecisiveConfidence: 0.7 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an evidence-free PASS to be rejected");
    expect(result.errors).toContain("Decisive assertions require evidence.");
  });

  it("downgrades a low-confidence PASS to UNCERTAIN", () => {
    const result = validateAssertionResult({
      schemaVersion: "1",
      status: "PASS",
      expected: "Project Alpha is visible",
      actual: "A project row is visible",
      confidence: 0.42,
      evidenceIds: [evidence.id],
      reason: "The row probably matches",
    }, { expected: "Project Alpha is visible", availableEvidenceIds: [evidence.id], minimumDecisiveConfidence: 0.7 });

    expect(result).toMatchObject({ ok: true, assertion: { status: "UNCERTAIN", confidence: 0.42 } });
  });

  it("rejects FAIL when evidence is missing or belongs outside the step", () => {
    const result = validateAssertionResult({
      schemaVersion: "1",
      status: "FAIL",
      expected: "Project Alpha is visible",
      actual: "No projects yet",
      confidence: 0.95,
      evidenceIds: ["unknown-evidence"],
      reason: "The expected project is absent",
    }, { expected: "Project Alpha is visible", availableEvidenceIds: [evidence.id], minimumDecisiveConfidence: 0.7 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an ungrounded failure to be rejected");
    expect(result.errors).toContain("Assertion references evidence outside the current run step.");
  });
});

describe("Phase 4 bug report contract", () => {
  const failedAssertion = {
    schemaVersion: "1" as const,
    status: "FAIL" as const,
    expected: "Project Alpha is visible",
    actual: "No projects yet",
    confidence: 0.96,
    evidenceIds: [evidence.id],
    reason: "The expected project is absent",
  };

  it("accepts a structured report grounded in the failed assertion", () => {
    const report = {
      schemaVersion: "1",
      title: "Created project is missing from the project list",
      summary: "The creation flow completed, but the new project did not appear.",
      category: "FUNCTIONAL",
      severity: "HIGH",
      classification: "REAL_BUG",
      stepsToReproduce: ["Open the project form", "Create Project Alpha"],
      expected: failedAssertion.expected,
      actual: failedAssertion.actual,
      evidenceIds: [evidence.id],
      confidence: 0.9,
    };
    expect(validateBugReport(report, { assertion: failedAssertion, availableEvidenceIds: [evidence.id] })).toEqual({ ok: true, report });
  });

  it("rejects a report that rewrites the assertion or cites unrelated evidence", () => {
    const result = validateBugReport({
      schemaVersion: "1",
      title: "Project issue",
      summary: "The project did not appear.",
      category: "FUNCTIONAL",
      severity: "HIGH",
      classification: "REAL_BUG",
      stepsToReproduce: ["Create a project"],
      expected: "A different expectation",
      actual: failedAssertion.actual,
      evidenceIds: ["unrelated"],
      confidence: 0.9,
    }, { assertion: failedAssertion, availableEvidenceIds: [evidence.id] });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an ungrounded report to be rejected");
    expect(result.errors).toContain("Bug report expected and actual fields must match the failed assertion.");
    expect(result.errors).toContain("Bug report references evidence outside the failed step.");
  });
});
