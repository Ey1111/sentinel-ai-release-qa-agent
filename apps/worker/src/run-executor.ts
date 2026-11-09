import { createHash } from "node:crypto";
import { BugReporterTask, ControlledQaWorkflow, ObserverAgent, QaExecutionAgent, type ControlledQaResult } from "@sentinel/agent-core";
import { InteractiveBrowserSession } from "@sentinel/browser-runtime";
import type { ClaimedRun, OutcomeSnapshot } from "@sentinel/db";
import type { LLMProvider } from "@sentinel/llm";
import { SessionQaBrowserTool } from "./session-adapter";
import type { RunSecrets } from "./test-secrets";
import type { ExecutionOutcome } from "./worker-loop";

export type RunExecutorOptions = {
  artifactRoot: string;
  allowLocalhost: boolean;
  createProvider: (run: ClaimedRun) => LLMProvider;
  secretsFor?: (run: ClaimedRun) => RunSecrets;
  timeoutMs?: number;
};

export function createRunExecutor(options: RunExecutorOptions) {
  return async (run: ClaimedRun): Promise<ExecutionOutcome> => {
    const provider = options.createProvider(run);
    const secrets = options.secretsFor?.(run);
    const session = new InteractiveBrowserSession({
      ...(secrets ? { resolveSecret: secrets.resolve } : {}),
      runId: run.id,
      artifactRoot: options.artifactRoot,
      allowedOrigins: run.allowedOrigins,
      allowLocalhost: options.allowLocalhost,
      timeoutMs: options.timeoutMs ?? 10_000,
      headless: true,
    });
    await session.open();
    try {
      const workflow = new ControlledQaWorkflow(new QaExecutionAgent(provider), new SessionQaBrowserTool(session), {
        observer: new ObserverAgent(provider, { minimumDecisiveConfidence: 0.7 }),
        bugReporter: new BugReporterTask(provider),
      });
      const result = await workflow.run({
        runId: run.id,
        testGoal: run.testGoal,
        targetUrl: run.targetUrl,
        approvedPlan: run.plan.plan,
        allowedOrigins: run.allowedOrigins,
        ...(secrets ? { availableSecretRefs: secrets.refs } : {}),
        budgets: { maxActions: run.maxSteps, maxRetriesPerStep: 2, maxLlmCalls: run.maxSteps * 3 + run.plan.plan.steps.length * 2 },
      });
      return toExecutionOutcome(run, result);
    } finally {
      await session.close();
    }
  };
}

export function toExecutionOutcome(run: ClaimedRun, result: ControlledQaResult): ExecutionOutcome {
  if (result.status !== "PASS" && result.status !== "FAIL" && result.status !== "UNCERTAIN") {
    return { kind: "FAILED", reason: result.reason ? `${result.status}: ${result.reason}` : result.status };
  }

  const assertionByStep = new Map(result.assertions.map((item) => [item.stepId, item.assertion]));
  const steps: OutcomeSnapshot["steps"] = [];
  for (const [index, step] of run.plan.plan.steps.entries()) {
    const assertion = assertionByStep.get(step.id);
    if (!assertion) {
      // A FAIL stops the run early, so the steps after it were never evaluated.
      if (result.status === "FAIL") break;
      return { kind: "FAILED", reason: `MISSING_ASSERTION: ${step.id}` };
    }
    steps.push({ id: step.id, sequence: index + 1, description: step.description, expected: step.expectedState, assertion });
  }

  return {
    kind: "COMPLETED",
    snapshot: {
      runId: run.id,
      result: result.status,
      steps,
      evidence: result.evidence,
      bugs: result.bugDrafts.map((draft) => ({
        id: `bug-${createHash("sha256").update(`${run.id}:${draft.stepId}`).digest("hex").slice(0, 24)}`,
        runId: run.id,
        stepId: draft.stepId,
        revision: 1,
        status: draft.status,
        report: draft.report,
        provenance: draft.provenance,
      })),
    },
  };
}
