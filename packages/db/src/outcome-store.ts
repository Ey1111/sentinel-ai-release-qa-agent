import {
  AssertionResultSchema,
  validateAssertionResult,
  validateBugReport,
  validateEvidence,
  type AssertionResult,
  type BugReport,
  type Evidence,
} from "@sentinel/contracts";
import type { LLMCallMetadata } from "@sentinel/llm";

export type OutcomeStep = {
  id: string;
  sequence: number;
  description: string;
  expected: string;
  assertion: AssertionResult;
};

export type OutcomeBug = {
  id: string;
  runId: string;
  stepId: string;
  revision: number;
  status: "DRAFT";
  report: BugReport;
  provenance: LLMCallMetadata;
};

export type OutcomeSnapshot = {
  runId: string;
  result: "PASS" | "FAIL" | "UNCERTAIN";
  steps: OutcomeStep[];
  evidence: Evidence[];
  bugs: OutcomeBug[];
};

export type BugDetail = OutcomeBug & { evidence: Evidence[] };

export class OutcomeStore {
  private readonly outcomes = new Map<string, OutcomeSnapshot>();

  constructor(private readonly minimumDecisiveConfidence = 0.7) {}

  record(snapshot: OutcomeSnapshot): void {
    const validated = validateSnapshot(structuredClone(snapshot), this.minimumDecisiveConfidence);
    for (const bug of validated.bugs) {
      for (const existing of this.outcomes.values()) {
        if (existing.runId !== validated.runId && existing.bugs.some((candidate) => candidate.id === bug.id)) {
          throw new Error(`Bug ID ${bug.id} is already owned by run ${existing.runId}.`);
        }
      }
    }
    this.outcomes.set(validated.runId, validated);
  }

  read(runId: string): OutcomeSnapshot | undefined {
    const outcome = this.outcomes.get(runId);
    return outcome ? structuredClone(outcome) : undefined;
  }

  readBug(bugId: string): BugDetail | undefined {
    for (const outcome of this.outcomes.values()) {
      const bug = outcome.bugs.find((candidate) => candidate.id === bugId);
      if (!bug) continue;
      const evidenceById = new Map(outcome.evidence.map((item) => [item.id, item]));
      return structuredClone({
        ...bug,
        evidence: bug.report.evidenceIds.map((id) => {
          const evidence = evidenceById.get(id);
          if (!evidence) throw new Error(`Bug ${bug.id} references missing evidence ${id}.`);
          return evidence;
        }),
      });
    }
    return undefined;
  }
}

export function validateSnapshot(snapshot: OutcomeSnapshot, minimumDecisiveConfidence: number): OutcomeSnapshot {
  requireText(snapshot.runId, "Run ID");
  if (!(["PASS", "FAIL", "UNCERTAIN"] as const).includes(snapshot.result)) {
    throw new Error(`Unsupported run result: ${String(snapshot.result)}.`);
  }
  if (!Array.isArray(snapshot.steps) || snapshot.steps.length === 0) throw new Error("Outcome must contain at least one step.");
  if (!Array.isArray(snapshot.evidence)) throw new Error("Outcome evidence must be an array.");
  if (!Array.isArray(snapshot.bugs)) throw new Error("Outcome bugs must be an array.");

  const stepIds = new Set<string>();
  const sequences = new Set<number>();
  for (const step of snapshot.steps) {
    requireText(step.id, "Step ID");
    requireText(step.description, `Step ${step.id} description`);
    requireText(step.expected, `Step ${step.id} expected state`);
    if (!Number.isInteger(step.sequence) || step.sequence < 1) throw new Error(`Step ${step.id} sequence must be a positive integer.`);
    if (stepIds.has(step.id)) throw new Error(`Step ID ${step.id} must be unique within the run.`);
    if (sequences.has(step.sequence)) throw new Error(`Step sequence ${step.sequence} must be unique within the run.`);
    const parsedAssertion = AssertionResultSchema.safeParse(step.assertion);
    if (!parsedAssertion.success) throw new Error(`Step ${step.id} assertion is invalid: ${parsedAssertion.error.issues.map((issue) => issue.message).join(" ")}`);
    if (parsedAssertion.data.expected !== step.expected) throw new Error(`Step ${step.id} assertion must preserve the approved expected state.`);
    step.assertion = parsedAssertion.data;
    stepIds.add(step.id);
    sequences.add(step.sequence);
  }

  const evidenceIds = new Set<string>();
  const evidenceById = new Map<string, Evidence>();
  for (const candidate of snapshot.evidence) {
    const validated = validateEvidence(candidate);
    const candidateId = typeof candidate?.id === "string" && candidate.id ? candidate.id : "unknown";
    if (!validated.ok) throw new Error(`Evidence ${candidateId} is invalid: ${validated.errors.join(" ")}`);
    const evidence = validated.evidence;
    if (evidence.runId !== snapshot.runId) throw new Error(`Evidence ${evidence.id} must belong to run ${snapshot.runId}.`);
    if (!stepIds.has(evidence.stepId)) throw new Error(`Evidence ${evidence.id} references unknown step ${evidence.stepId}.`);
    if (evidenceIds.has(evidence.id)) throw new Error(`Evidence ID ${evidence.id} must be unique within the run.`);
    evidenceIds.add(evidence.id);
    evidenceById.set(evidence.id, evidence);
  }

  for (const step of snapshot.steps) {
    if (step.assertion.evidenceIds.some((id) => evidenceById.get(id)?.stepId !== step.id)) {
      throw new Error(`Step ${step.id} references evidence outside its run step.`);
    }
    const availableEvidenceIds = snapshot.evidence.filter((item) => item.stepId === step.id).map((item) => item.id);
    const validated = validateAssertionResult(step.assertion, {
      expected: step.expected,
      availableEvidenceIds,
      minimumDecisiveConfidence,
    });
    if (!validated.ok) throw new Error(`Step ${step.id} assertion is invalid: ${validated.errors.join(" ")}`);
    if (validated.assertion.status !== step.assertion.status) {
      throw new Error(`Step ${step.id} decisive assertion confidence ${step.assertion.confidence} is below ${minimumDecisiveConfidence}.`);
    }
    step.assertion = validated.assertion;
  }

  const aggregateResult = aggregate(snapshot.steps.map((step) => step.assertion));
  if (snapshot.result !== aggregateResult) {
    throw new Error(`Run result ${snapshot.result} does not match aggregate step result ${aggregateResult}.`);
  }

  const bugIds = new Set<string>();
  const bugStepIds = new Set<string>();
  for (const bug of snapshot.bugs) {
    requireText(bug.id, "Bug ID");
    if (bugIds.has(bug.id)) throw new Error(`Bug ID ${bug.id} must be unique within the run.`);
    if (bug.runId !== snapshot.runId) throw new Error(`Bug ${bug.id} must belong to run ${snapshot.runId}.`);
    const step = snapshot.steps.find((candidate) => candidate.id === bug.stepId);
    if (!step) throw new Error(`Bug ${bug.id} references unknown step ${bug.stepId}.`);
    if (!Number.isInteger(bug.revision) || bug.revision < 1) throw new Error(`Bug ${bug.id} revision must be a positive integer.`);
    if (bug.status !== "DRAFT") throw new Error(`Bug ${bug.id} must remain a DRAFT in Phase 4.`);
    if (!isBugReporterProvenance(bug.provenance)) throw new Error(`Bug ${bug.id} requires valid Bug Reporter provenance.`);
    const availableEvidenceIds = snapshot.evidence.filter((item) => item.stepId === bug.stepId).map((item) => item.id);
    const validated = validateBugReport(bug.report, { assertion: step.assertion, availableEvidenceIds });
    if (!validated.ok) throw new Error(`Bug ${bug.id} is invalid: ${validated.errors.join(" ")}`);
    bug.report = validated.report;
    bugIds.add(bug.id);
    bugStepIds.add(bug.stepId);
  }

  for (const step of snapshot.steps) {
    if (step.assertion.status === "FAIL" && !bugStepIds.has(step.id)) {
      throw new Error(`Failed step ${step.id} requires at least one DRAFT bug.`);
    }
  }

  snapshot.steps.sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  snapshot.evidence.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  snapshot.bugs.sort((left, right) => left.id.localeCompare(right.id));
  return snapshot;
}

function aggregate(assertions: AssertionResult[]): OutcomeSnapshot["result"] {
  if (assertions.some((assertion) => assertion.status === "FAIL")) return "FAIL";
  if (assertions.some((assertion) => assertion.status === "UNCERTAIN")) return "UNCERTAIN";
  return "PASS";
}

function requireText(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
}

function isBugReporterProvenance(value: unknown): value is LLMCallMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Record<string, unknown>;
  const requiredStrings = ["provider", "model"];
  if (requiredStrings.some((field) => typeof metadata[field] !== "string" || !(metadata[field] as string).trim())) return false;
  if (metadata.promptId !== "bug-reporter.v1" || metadata.schemaVersion !== "1") return false;
  if (typeof metadata.promptHash !== "string" || !/^[a-f0-9]{64}$/.test(metadata.promptHash)) return false;
  if (typeof metadata.isMock !== "boolean" || !isNonNegativeNumber(metadata.latencyMs)) return false;
  return ["inputTokens", "outputTokens", "totalTokens", "estimatedCostMicros"]
    .every((field) => metadata[field] === null || isNonNegativeNumber(metadata[field]));
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
