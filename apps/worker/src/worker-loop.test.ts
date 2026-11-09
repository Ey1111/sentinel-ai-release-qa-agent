import { describe, expect, it, vi } from "vitest";
import { InMemoryRunStore, type ClaimedRun, type OutcomeSnapshot, type RunRecord } from "@sentinel/db";
import type { ControlledQaResult } from "@sentinel/agent-core";
import { toExecutionOutcome } from "./run-executor";
import { RunWorker } from "./worker-loop";

const plan = {
  schemaVersion: "1" as const,
  title: "Check",
  goal: "Goal",
  assumptions: [],
  successCriteria: ["Done"],
  steps: [{ id: "step-1", description: "Open", intent: "Open", expectedState: "Open page visible", riskLevel: "LOW" as const, dependencies: [] }],
};
const provenance = { provider: "mock", model: "fixture", promptId: "planner.v1", promptHash: "a".repeat(64), schemaVersion: "1", latencyMs: 0, inputTokens: null, outputTokens: null, totalTokens: null, estimatedCostMicros: null, isMock: true };

function queuedRun(id = "run-1"): RunRecord {
  return { id, targetUrl: "http://example.test", testGoal: "Goal", maxSteps: 5, allowedOrigins: ["http://example.test"], status: "QUEUED", plan: { status: "APPROVED", version: 1, plan, provenance } };
}

async function storeWithQueuedRun(now?: () => number) {
  const store = new InMemoryRunStore(undefined, now);
  await store.createRun({ ...queuedRun(), status: "READY" });
  await store.mutateRun("run-1", (current) => { current.status = "QUEUED"; });
  return store;
}

function passingSnapshot(result: OutcomeSnapshot["result"] = "PASS"): OutcomeSnapshot {
  return {
    runId: "run-1",
    result,
    steps: [{ id: "step-1", sequence: 1, description: "Open", expected: "Open page visible", assertion: { schemaVersion: "1", status: "PASS", expected: "Open page visible", actual: "Visible", confidence: 1, evidenceIds: ["e1"], reason: "Seen" } }],
    evidence: [{ schemaVersion: "1", id: "e1", runId: "run-1", stepId: "step-1", type: "VISIBLE_TEXT", content: "Visible", createdAt: new Date(0).toISOString(), redactionStatus: "NOT_REQUIRED" }],
    bugs: [],
  };
}

describe("RunWorker", () => {
  it("returns false on an empty queue", async () => {
    const execute = vi.fn();
    expect(await new RunWorker({ store: new InMemoryRunStore(), workerId: "w", execute }).tick()).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("marks the run RUNNING during execution and COMPLETED with its outcome afterwards", async () => {
    const store = await storeWithQueuedRun();
    let statusDuringExecution: string | undefined;
    const worker = new RunWorker({
      store,
      workerId: "w",
      execute: async (run) => {
        statusDuringExecution = (await store.getRun(run.id))?.status;
        return { kind: "COMPLETED", snapshot: passingSnapshot() };
      },
    });

    expect(await worker.tick()).toBe(true);
    expect(statusDuringExecution).toBe("RUNNING");
    expect((await store.getRun("run-1"))?.status).toBe("COMPLETED");
    expect((await store.readOutcome("run-1"))?.result).toBe("PASS");
  });

  it("records a failure reason when the executor throws", async () => {
    const store = await storeWithQueuedRun();
    await new RunWorker({ store, workerId: "w", execute: async () => { throw new Error("browser crashed"); } }).tick();
    expect(await store.getRun("run-1")).toMatchObject({ status: "FAILED", failureReason: "EXECUTOR_ERROR: browser crashed" });
  });

  it("fails rather than completes when the outcome does not validate", async () => {
    const store = await storeWithQueuedRun();
    await new RunWorker({ store, workerId: "w", execute: async () => ({ kind: "COMPLETED", snapshot: passingSnapshot("FAIL") }) }).tick();
    const run = await store.getRun("run-1");
    expect(run?.status).toBe("FAILED");
    expect(run?.failureReason).toMatch(/^OUTCOME_REJECTED/);
    expect(await store.readOutcome("run-1")).toBeUndefined();
  });

  it("never claims a run twice", async () => {
    const store = await storeWithQueuedRun();
    expect(await store.claimNextRun("a")).toBeDefined();
    expect(await store.claimNextRun("b")).toBeUndefined();
  });

  it("fails an abandoned run instead of re-running its browser actions", async () => {
    let clock = 0;
    const store = await storeWithQueuedRun(() => clock);
    await store.claimNextRun("dead");
    clock = 120_000;
    await new RunWorker({ store, workerId: "w", execute: vi.fn(), staleAfterMs: 60_000 }).tick();
    expect(await store.getRun("run-1")).toMatchObject({ status: "FAILED", failureReason: "WORKER_LOST" });
    expect(await store.failRun("run-1", "dead", "late")).toBe(false);
  });
});

describe("toExecutionOutcome", () => {
  const run = queuedRun() as ClaimedRun;
  const base: ControlledQaResult = { status: "PASS", trace: [], actionsExecuted: 1, llmCalls: 1, assertions: [], evidence: [], bugDrafts: [] };

  it("reports a non-verdict workflow status as FAILED with its reason", () => {
    expect(toExecutionOutcome(run, { ...base, status: "BUDGET_EXHAUSTED", reason: "MAX_ACTIONS" })).toEqual({ kind: "FAILED", reason: "BUDGET_EXHAUSTED: MAX_ACTIONS" });
  });

  it("refuses a verdict that is missing a step assertion", () => {
    expect(toExecutionOutcome(run, base)).toEqual({ kind: "FAILED", reason: "MISSING_ASSERTION: step-1" });
  });

  it("derives a stable bug id and keeps plan order", () => {
    const assertion = { schemaVersion: "1" as const, status: "FAIL" as const, expected: "Open page visible", actual: "Blank", confidence: 1, evidenceIds: ["e1"], reason: "Missing" };
    const bugReport = { schemaVersion: "1" as const, title: "T", summary: "S", category: "FUNCTIONAL" as const, severity: "HIGH" as const, classification: "REAL_BUG" as const, stepsToReproduce: ["x"], expected: assertion.expected, actual: assertion.actual, evidenceIds: ["e1"], confidence: 1 };
    const result = { ...base, status: "FAIL" as const, assertions: [{ stepId: "step-1", assertion, source: "DETERMINISTIC" as const }], bugDrafts: [{ stepId: "step-1", status: "DRAFT" as const, report: bugReport, provenance }] };
    const first = toExecutionOutcome(run, result);
    const second = toExecutionOutcome(run, result);
    expect(first.kind).toBe("COMPLETED");
    if (first.kind !== "COMPLETED" || second.kind !== "COMPLETED") return;
    expect(first.snapshot.steps[0]).toMatchObject({ id: "step-1", sequence: 1 });
    expect(first.snapshot.bugs[0]?.id).toBe(second.snapshot.bugs[0]?.id);
    expect(first.snapshot.bugs[0]?.id).toMatch(/^bug-[a-f0-9]{24}$/);
  });
});
