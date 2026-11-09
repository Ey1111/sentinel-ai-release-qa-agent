import { z } from "zod";

const assertionBase = {
  id: z.string().trim().min(1),
  value: z.string().trim().min(1),
  required: z.boolean(),
};

export const DeterministicAssertionSchema = z.discriminatedUnion("type", [
  z.object({ ...assertionBase, type: z.literal("VISIBLE_TEXT_CONTAINS") }).strict(),
  z.object({ ...assertionBase, type: z.literal("VISIBLE_TEXT_NOT_CONTAINS") }).strict(),
  z.object({ ...assertionBase, type: z.literal("TITLE_EQUALS") }).strict(),
  z.object({ ...assertionBase, type: z.literal("URL_PATH_EQUALS"), value: z.string().trim().startsWith("/").min(1) }).strict(),
  z.object({ ...assertionBase, type: z.literal("INTERACTIVE_ELEMENT_VISIBLE") }).strict(),
]);

export const TestPlanStepSchema = z.object({
  id: z.string().trim().min(1),
  description: z.string().trim().min(1),
  intent: z.string().trim().min(1),
  expectedState: z.string().trim().min(1),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  dependencies: z.array(z.string().trim().min(1)),
  assertions: z.array(DeterministicAssertionSchema).optional(),
}).strict();

export const TestPlanSchema = z.object({
  schemaVersion: z.literal("1"),
  title: z.string().trim().min(1),
  goal: z.string().trim().min(1),
  assumptions: z.array(z.string().trim().min(1)),
  successCriteria: z.array(z.string().trim().min(1)).min(1),
  steps: z.array(TestPlanStepSchema).min(1),
}).strict();

export type TestPlan = z.infer<typeof TestPlanSchema>;
export type TestPlanStep = z.infer<typeof TestPlanStepSchema>;
export type DeterministicAssertion = z.infer<typeof DeterministicAssertionSchema>;

export const BrowserActionProposalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NAVIGATE"), url: z.string().url() }).strict(),
  z.object({ type: z.literal("CLICK"), elementRef: z.string().trim().min(1) }).strict(),
  z.object({
    type: z.literal("FILL"),
    elementRef: z.string().trim().min(1),
    value: z.union([z.string(), z.object({ secretRef: z.string().trim().min(1) }).strict()]),
  }).strict(),
  z.object({ type: z.literal("SCREENSHOT"), reason: z.string().trim().min(1) }).strict(),
]);

export const AgentDecisionSchema = z.object({
  schemaVersion: z.literal("1"),
  type: z.enum(["ACTION", "ASSERT", "RETRY", "PAUSE", "ESCALATE", "FINISH", "FAIL"]),
  stepId: z.string().trim().min(1),
  action: BrowserActionProposalSchema.optional(),
  expectedState: z.string().trim().min(1).optional(),
  conciseReason: z.string().trim().min(1),
  confidence: z.number().finite().min(0).max(1),
}).strict().superRefine((decision, context) => {
  if (decision.type === "ACTION" && !decision.action) {
    context.addIssue({ code: "custom", path: ["action"], message: "ACTION decisions require an action payload." });
  }
  if (decision.type !== "ACTION" && decision.action) {
    context.addIssue({ code: "custom", path: ["action"], message: "Only ACTION decisions may contain an action payload." });
  }
});

export type BrowserActionProposal = z.infer<typeof BrowserActionProposalSchema>;
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

export type AgentDecisionValidationResult =
  | { ok: true; decision: AgentDecision }
  | { ok: false; errors: string[] };

export function validateAgentDecision(
  input: unknown,
  context: { currentStepId: string; allowedOrigins: string[]; elementRefs: string[] },
): AgentDecisionValidationResult {
  const parsed = AgentDecisionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) };
  }

  const decision = parsed.data;
  if (decision.stepId !== context.currentStepId) {
    return { ok: false, errors: ["Decision step does not match the current approved plan step."] };
  }

  if (decision.action?.type === "NAVIGATE") {
    const origin = new URL(decision.action.url).origin;
    if (!context.allowedOrigins.includes(origin)) {
      return { ok: false, errors: ["Navigation is outside the allowed origins."] };
    }
  }

  if (decision.action && (decision.action.type === "CLICK" || decision.action.type === "FILL")) {
    if (!context.elementRefs.includes(decision.action.elementRef)) {
      return { ok: false, errors: ["Action references an element outside the current observation."] };
    }
  }

  return { ok: true, decision };
}

export type PlanValidationResult =
  | { ok: true; plan: TestPlan; requiresHumanReview: boolean }
  | { ok: false; errors: string[] };

export function validateTestPlan(input: unknown, options: { maxSteps: number }): PlanValidationResult {
  const parsed = TestPlanSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "plan"}: ${issue.message}`) };
  }

  const errors: string[] = [];
  const plan = parsed.data;
  if (plan.steps.length > options.maxSteps) {
    errors.push(`Plan has ${plan.steps.length} steps but the run budget allows ${options.maxSteps}.`);
  }

  const ids = new Set(plan.steps.map((step) => step.id));
  if (ids.size !== plan.steps.length) errors.push("Plan step IDs must be unique.");
  for (const step of plan.steps) {
    if (step.dependencies.some((dependency) => !ids.has(dependency))) {
      errors.push(`Step ${step.id} depends on an unknown step.`);
    }
    if (step.assertions && new Set(step.assertions.map((assertion) => assertion.id)).size !== step.assertions.length) {
      errors.push(`Step ${step.id} assertion IDs must be unique.`);
    }
  }
  if (hasDependencyCycle(plan.steps)) errors.push("Plan step dependencies must be acyclic.");

  const planText = JSON.stringify(plan);
  if (/https?:\/\/|(^|[\s"'])#[a-zA-Z][\w-]*|\b(?:xpath|css selector)\b/i.test(planText)) {
    errors.push("Plan content must not contain raw selectors or URLs.");
  }

  return errors.length > 0
    ? { ok: false, errors: [...new Set(errors)] }
    : { ok: true, plan, requiresHumanReview: plan.steps.some((step) => step.riskLevel === "HIGH") };
}

function hasDependencyCycle(steps: TestPlanStep[]): boolean {
  const dependencies = new Map(steps.map((step) => [step.id, step.dependencies]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return steps.some((step) => visit(step.id));
}

export const EvidenceTypeSchema = z.enum([
  "SCREENSHOT",
  "CONSOLE_ERROR",
  "NETWORK_FAILURE",
  "DOM_STATE",
  "VISIBLE_TEXT",
  "PLAYWRIGHT_ERROR",
  "ASSERTION",
  "TRACE",
]);

export const EvidenceSchema = z.object({
  schemaVersion: z.literal("1"),
  id: z.string().trim().min(1),
  runId: z.string().trim().min(1),
  stepId: z.string().trim().min(1),
  type: EvidenceTypeSchema,
  content: z.string().trim().min(1).optional(),
  artifactPath: z.string().trim().min(1).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  createdAt: z.string().datetime(),
  redactionStatus: z.enum(["NOT_REQUIRED", "REDACTED", "REVIEW_REQUIRED"]),
}).strict();

export const AssertionResultSchema = z.object({
  schemaVersion: z.literal("1"),
  status: z.enum(["PASS", "FAIL", "UNCERTAIN"]),
  expected: z.string().trim().min(1),
  actual: z.string().trim().min(1),
  confidence: z.number().finite().min(0).max(1),
  evidenceIds: z.array(z.string().trim().min(1)),
  reason: z.string().trim().min(1),
}).strict();

export const BugReportSchema = z.object({
  schemaVersion: z.literal("1"),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  category: z.enum(["FUNCTIONAL", "UI", "NETWORK", "CONSOLE", "AUTH", "AUTOMATION", "ENVIRONMENT", "UNKNOWN"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  classification: z.enum(["REAL_BUG", "AUTOMATION_ERROR", "FLAKY", "ENVIRONMENT_ERROR", "UNCERTAIN"]),
  stepsToReproduce: z.array(z.string().trim().min(1)).min(1),
  expected: z.string().trim().min(1),
  actual: z.string().trim().min(1),
  evidenceIds: z.array(z.string().trim().min(1)).min(1),
  confidence: z.number().finite().min(0).max(1),
}).strict();

export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type AssertionResult = z.infer<typeof AssertionResultSchema>;
export type BugReport = z.infer<typeof BugReportSchema>;

type ValidationResult<T, K extends string> = { ok: true } & Record<K, T> | { ok: false; errors: string[] };

export function validateEvidence(input: unknown): ValidationResult<Evidence, "evidence"> {
  const parsed = EvidenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) };
  const errors: string[] = [];
  if (!parsed.data.content && !parsed.data.artifactPath) errors.push("Evidence must contain content or an artifact path.");
  if (parsed.data.type === "SCREENSHOT" && !parsed.data.artifactPath) errors.push("Screenshot evidence requires an artifact path.");
  if (parsed.data.type === "TRACE" && !parsed.data.artifactPath) errors.push("Trace evidence requires an artifact path.");
  if (parsed.data.artifactPath && !parsed.data.sha256) errors.push("Artifact evidence requires a SHA-256 hash.");
  return errors.length ? { ok: false, errors } : { ok: true, evidence: parsed.data };
}

export function validateAssertionResult(
  input: unknown,
  context: { expected: string; availableEvidenceIds: string[]; minimumDecisiveConfidence: number },
): ValidationResult<AssertionResult, "assertion"> {
  const parsed = AssertionResultSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) };
  const errors: string[] = [];
  if (parsed.data.expected !== context.expected) errors.push("Assertion expected state must match the approved plan step.");
  if (parsed.data.status !== "UNCERTAIN" && parsed.data.evidenceIds.length === 0) errors.push("Decisive assertions require evidence.");
  const available = new Set(context.availableEvidenceIds);
  if (parsed.data.evidenceIds.some((id) => !available.has(id))) errors.push("Assertion references evidence outside the current run step.");
  if (new Set(parsed.data.evidenceIds).size !== parsed.data.evidenceIds.length) errors.push("Assertion evidence IDs must be unique.");
  if (errors.length) return { ok: false, errors };
  const assertion = parsed.data.status !== "UNCERTAIN" && parsed.data.confidence < context.minimumDecisiveConfidence
    ? { ...parsed.data, status: "UNCERTAIN" as const }
    : parsed.data;
  return { ok: true, assertion };
}

export function validateBugReport(
  input: unknown,
  context: { assertion: AssertionResult; availableEvidenceIds: string[] },
): ValidationResult<BugReport, "report"> {
  const parsed = BugReportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) };
  const errors: string[] = [];
  if (context.assertion.status !== "FAIL") errors.push("Bug reports require a failed assertion.");
  if (parsed.data.expected !== context.assertion.expected || parsed.data.actual !== context.assertion.actual) {
    errors.push("Bug report expected and actual fields must match the failed assertion.");
  }
  const available = new Set(context.availableEvidenceIds);
  const assertionEvidence = new Set(context.assertion.evidenceIds);
  if (parsed.data.evidenceIds.some((id) => !available.has(id) || !assertionEvidence.has(id))) {
    errors.push("Bug report references evidence outside the failed step.");
  }
  if (new Set(parsed.data.evidenceIds).size !== parsed.data.evidenceIds.length) errors.push("Bug report evidence IDs must be unique.");
  return errors.length ? { ok: false, errors } : { ok: true, report: parsed.data };
}
