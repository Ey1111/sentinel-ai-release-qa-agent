import { describe, expect, it } from "vitest";
import type { AssertionResult, BugReport, Evidence } from "@sentinel/contracts";
import { OutcomeStore, type OutcomeSnapshot } from "./outcome-store";

const timestamp = "2026-08-31T00:00:00.000Z";
const bugReporterProvenance = {
  provider: "mock",
  model: "fixture",
  promptId: "bug-reporter.v1",
  promptHash: "b".repeat(64),
  schemaVersion: "1",
  latencyMs: 0,
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  estimatedCostMicros: null,
  isMock: true,
};

function textEvidence(id: string, runId: string, stepId: string, content: string, createdAt = timestamp): Evidence {
  return {
    schemaVersion: "1",
    id,
    runId,
    stepId,
    type: "VISIBLE_TEXT",
    content,
    createdAt,
    redactionStatus: "REDACTED",
  };
}

function assertion(status: AssertionResult["status"], expected: string, actual: string, evidenceIds: string[]): AssertionResult {
  return {
    schemaVersion: "1",
    status,
    expected,
    actual,
    confidence: status === "UNCERTAIN" ? 0.4 : 0.98,
    evidenceIds,
    reason: status === "PASS" ? "The expected state is visible." : status === "FAIL" ? "The expected state is absent." : "The evidence is inconclusive.",
  };
}

function oneStepSnapshot(options: {
  runId: string;
  result: OutcomeSnapshot["result"];
  stepId?: string;
  evidenceRunId?: string;
  evidenceStepId?: string;
  assertionEvidenceIds?: string[];
}): OutcomeSnapshot {
  const stepId = options.stepId ?? "step-1";
  const evidenceId = "evidence-visible";
  return {
    runId: options.runId,
    result: options.result,
    steps: [{
      id: stepId,
      sequence: 1,
      description: "Inspect the project list",
      expected: "Project Alpha is visible",
      assertion: assertion(options.result, "Project Alpha is visible", options.result === "PASS" ? "Project Alpha is visible" : "No projects yet", options.assertionEvidenceIds ?? [evidenceId]),
    }],
    evidence: [textEvidence(evidenceId, options.evidenceRunId ?? options.runId, options.evidenceStepId ?? stepId, options.result === "PASS" ? "Project Alpha is visible" : "No projects yet")],
    bugs: [],
  };
}

function draftBug(runId: string, id: string): OutcomeSnapshot["bugs"][number] {
  return {
    id,
    runId,
    stepId: "step-1",
    revision: 1,
    status: "DRAFT",
    provenance: bugReporterProvenance,
    report: {
      schemaVersion: "1",
      title: "Created project is missing",
      summary: "The completed creation flow did not leave a visible project row.",
      category: "FUNCTIONAL",
      severity: "HIGH",
      classification: "REAL_BUG",
      stepsToReproduce: ["Create Project Alpha"],
      expected: "Project Alpha is visible",
      actual: "No projects yet",
      evidenceIds: ["evidence-visible"],
      confidence: 0.94,
    },
  };
}

describe("OutcomeStore", () => {
  it("orders step and evidence reads deterministically", () => {
    const store = new OutcomeStore();
    store.record({
      runId: "run-pass",
      result: "PASS",
      steps: [
        { id: "step-2", sequence: 2, description: "Inspect Beta", expected: "Beta is visible", assertion: assertion("PASS", "Beta is visible", "Beta is visible", ["evidence-b"]) },
        { id: "step-1", sequence: 1, description: "Inspect Alpha", expected: "Alpha is visible", assertion: assertion("PASS", "Alpha is visible", "Alpha is visible", ["evidence-a"]) },
      ],
      evidence: [
        textEvidence("evidence-b", "run-pass", "step-2", "Beta is visible", "2026-08-31T00:00:02.000Z"),
        textEvidence("evidence-a", "run-pass", "step-1", "Alpha is visible", "2026-08-31T00:00:01.000Z"),
      ],
      bugs: [],
    });

    expect(store.read("run-pass")).toMatchObject({
      result: "PASS",
      steps: [{ id: "step-1" }, { id: "step-2" }],
      evidence: [{ id: "evidence-a" }, { id: "evidence-b" }],
      bugs: [],
    });
  });

  it("returns defensive copies from repeated reads", () => {
    const store = new OutcomeStore();
    store.record(oneStepSnapshot({ runId: "run-pass", result: "PASS" }));
    const first = store.read("run-pass");
    if (!first) throw new Error("Expected a recorded outcome");
    first.steps[0]!.description = "tampered";
    first.evidence[0]!.content = "tampered";

    expect(store.read("run-pass")).toMatchObject({
      steps: [{ description: "Inspect the project list" }],
      evidence: [{ content: "Project Alpha is visible" }],
    });
  });

  it("records an uncertain outcome without inventing a bug", () => {
    const store = new OutcomeStore();
    store.record(oneStepSnapshot({ runId: "run-uncertain", result: "UNCERTAIN" }));

    expect(store.read("run-uncertain")).toMatchObject({ result: "UNCERTAIN", bugs: [] });
  });

  it("rejects evidence owned by a different run", () => {
    const store = new OutcomeStore();

    expect(() => store.record(oneStepSnapshot({ runId: "run-1", result: "FAIL", evidenceRunId: "run-2" })))
      .toThrow("Evidence evidence-visible must belong to run run-1.");
    expect(store.read("run-1")).toBeUndefined();
  });

  it("rejects assertion evidence owned by a different step", () => {
    const store = new OutcomeStore();
    const snapshot = oneStepSnapshot({ runId: "run-1", result: "FAIL" });
    snapshot.steps.push({
      id: "step-2",
      sequence: 2,
      description: "Inspect another state",
      expected: "Another state is visible",
      assertion: assertion("PASS", "Another state is visible", "Another state is visible", ["evidence-visible"]),
    });

    expect(() => store.record(snapshot)).toThrow("Step step-2 references evidence outside its run step.");
  });

  it.each(["PASS", "FAIL"] as const)("rejects an evidence-free decisive %s assertion", (result) => {
    const store = new OutcomeStore();
    const snapshot = oneStepSnapshot({ runId: `run-${result.toLowerCase()}`, result });
    snapshot.steps[0]!.assertion.evidenceIds = [];

    expect(() => store.record(snapshot)).toThrow("Step step-1 assertion is invalid: Decisive assertions require evidence.");
  });

  it("rejects a low-confidence decisive assertion", () => {
    const store = new OutcomeStore();
    const snapshot = oneStepSnapshot({ runId: "run-low-confidence", result: "PASS" });
    snapshot.steps[0]!.assertion.confidence = 0.69;

    expect(() => store.record(snapshot)).toThrow("Step step-1 decisive assertion confidence 0.69 is below 0.7.");
  });

  it("rejects a run result that disagrees with its step assertions", () => {
    const store = new OutcomeStore();
    const snapshot = oneStepSnapshot({ runId: "run-1", result: "PASS" });
    snapshot.result = "FAIL";

    expect(() => store.record(snapshot)).toThrow("Run result FAIL does not match aggregate step result PASS.");
  });

  it("rejects a failed step without a DRAFT bug", () => {
    const store = new OutcomeStore();

    expect(() => store.record(oneStepSnapshot({ runId: "run-fail", result: "FAIL" })))
      .toThrow("Failed step step-1 requires at least one DRAFT bug.");
  });

  it("returns an evidence-bound DRAFT bug detail for a failed outcome", () => {
    const store = new OutcomeStore();
    const snapshot = oneStepSnapshot({ runId: "run-fail", result: "FAIL" });
    const report: BugReport = {
      schemaVersion: "1",
      title: "Created project is missing",
      summary: "The completed creation flow did not leave a visible project row.",
      category: "FUNCTIONAL",
      severity: "HIGH",
      classification: "REAL_BUG",
      stepsToReproduce: ["Open the project form", "Create Project Alpha"],
      expected: "Project Alpha is visible",
      actual: "No projects yet",
      evidenceIds: ["evidence-visible"],
      confidence: 0.94,
    };
    snapshot.bugs.push({ id: "bug-1", runId: "run-fail", stepId: "step-1", revision: 1, status: "DRAFT", report, provenance: bugReporterProvenance });
    store.record(snapshot);

    expect(store.readBug("bug-1")).toEqual({
      id: "bug-1",
      runId: "run-fail",
      stepId: "step-1",
      revision: 1,
      status: "DRAFT",
      report,
      provenance: bugReporterProvenance,
      evidence: [textEvidence("evidence-visible", "run-fail", "step-1", "No projects yet")],
    });
  });

  it("rejects a bug ID already owned by another run", () => {
    const store = new OutcomeStore();
    const first = oneStepSnapshot({ runId: "run-1", result: "FAIL" });
    first.bugs.push(draftBug("run-1", "bug-shared"));
    store.record(first);

    const second = oneStepSnapshot({ runId: "run-2", result: "FAIL" });
    second.bugs.push(draftBug("run-2", "bug-shared"));

    expect(() => store.record(second)).toThrow("Bug ID bug-shared is already owned by run run-1.");
    expect(store.read("run-2")).toBeUndefined();
    expect(store.readBug("bug-shared")?.runId).toBe("run-1");
  });

  it("rejects a bug without Bug Reporter provenance", () => {
    const store = new OutcomeStore();
    const snapshot = oneStepSnapshot({ runId: "run-fail", result: "FAIL" });
    snapshot.bugs.push({
      id: "bug-1",
      runId: "run-fail",
      stepId: "step-1",
      revision: 1,
      status: "DRAFT",
      report: {
        schemaVersion: "1",
        title: "Created project is missing",
        summary: "The project row is missing.",
        category: "FUNCTIONAL",
        severity: "HIGH",
        classification: "REAL_BUG",
        stepsToReproduce: ["Create Project Alpha"],
        expected: "Project Alpha is visible",
        actual: "No projects yet",
        evidenceIds: ["evidence-visible"],
        confidence: 0.94,
      },
    } as unknown as OutcomeSnapshot["bugs"][number]);

    expect(() => store.record(snapshot)).toThrow("Bug bug-1 requires valid Bug Reporter provenance.");
  });

  it.each([
    ["prompt ID", { promptId: "bug-reporter.v2" }],
    ["schema version", { schemaVersion: "2" }],
    ["prompt hash", { promptHash: "g".repeat(64) }],
  ])("rejects Bug Reporter provenance with an invalid %s", (_field, override) => {
    const store = new OutcomeStore();
    const snapshot = oneStepSnapshot({ runId: "run-fail", result: "FAIL" });
    const bug = draftBug("run-fail", "bug-1");
    bug.provenance = { ...bug.provenance, ...override };
    snapshot.bugs.push(bug);

    expect(() => store.record(snapshot)).toThrow("Bug bug-1 requires valid Bug Reporter provenance.");
  });

  it("rejects a bug that is not a DRAFT", () => {
    const store = new OutcomeStore();
    const snapshot = oneStepSnapshot({ runId: "run-fail", result: "FAIL" });
    snapshot.bugs.push({
      id: "bug-1",
      runId: "run-fail",
      stepId: "step-1",
      revision: 1,
      status: "APPROVED",
      provenance: bugReporterProvenance,
      report: {
        schemaVersion: "1",
        title: "Created project is missing",
        summary: "The project row is missing.",
        category: "FUNCTIONAL",
        severity: "HIGH",
        classification: "REAL_BUG",
        stepsToReproduce: ["Create Project Alpha"],
        expected: "Project Alpha is visible",
        actual: "No projects yet",
        evidenceIds: ["evidence-visible"],
        confidence: 0.94,
      },
    } as unknown as OutcomeSnapshot["bugs"][number]);

    expect(() => store.record(snapshot)).toThrow("Bug bug-1 must remain a DRAFT in Phase 4.");
  });
});
