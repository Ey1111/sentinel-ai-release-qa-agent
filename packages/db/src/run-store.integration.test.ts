import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase, PostgresRunStore, type OutcomeSnapshot, type RunRecord } from "./index";

const databaseUrl = process.env.SENTINEL_TEST_DATABASE_URL;

// Needs a real PostgreSQL. Set SENTINEL_TEST_DATABASE_URL to run; skipped otherwise, never faked.
describe.skipIf(!databaseUrl)("PostgresRunStore", () => {
  const first = createDatabase(databaseUrl ?? "postgres://unused:unused@localhost/unused").client;
  const second = createDatabase(databaseUrl ?? "postgres://unused:unused@localhost/unused").client;
  const store = new PostgresRunStore(first);
  const restarted = new PostgresRunStore(second);

  afterAll(async () => {
    await Promise.all([first.end({ timeout: 2 }), second.end({ timeout: 2 })]);
  });

  const plan = { schemaVersion: "1" as const, title: "T", goal: "G", assumptions: [], successCriteria: ["S"], steps: [{ id: "step-1", description: "D", intent: "I", expectedState: "E", riskLevel: "LOW" as const, dependencies: [] }] };
  const provenance = { provider: "mock", model: "fixture", promptId: "bug-reporter.v1", promptHash: "a".repeat(64), schemaVersion: "1", latencyMs: 0, inputTokens: null, outputTokens: null, totalTokens: null, estimatedCostMicros: null, isMock: true };

  function newRun(): RunRecord {
    return { id: randomUUID(), targetUrl: "http://example.test", testGoal: "G", maxSteps: 5, allowedOrigins: ["http://example.test"], status: "READY", plan: { status: "APPROVED", version: 3, plan, provenance } };
  }

  async function queued(): Promise<RunRecord> {
    const run = newRun();
    await store.createRun(run);
    await store.mutateRun(run.id, (current) => { current.status = "QUEUED"; });
    return run;
  }

  function failedSnapshot(runId: string): OutcomeSnapshot {
    const evidenceId = `evidence-${runId}`;
    const assertion = { schemaVersion: "1" as const, status: "FAIL" as const, expected: "E", actual: "A", confidence: 1, evidenceIds: [evidenceId], reason: "R" };
    return {
      runId,
      result: "FAIL",
      steps: [{ id: "step-1", sequence: 1, description: "D", expected: "E", assertion }],
      evidence: [{ schemaVersion: "1", id: evidenceId, runId, stepId: "step-1", type: "VISIBLE_TEXT", content: "A", createdAt: new Date(0).toISOString(), redactionStatus: "NOT_REQUIRED" }],
      bugs: [{ id: `bug-${runId}`, runId, stepId: "step-1", revision: 1, status: "DRAFT", provenance, report: { schemaVersion: "1", title: "T", summary: "S", category: "FUNCTIONAL", severity: "HIGH", classification: "REAL_BUG", stepsToReproduce: ["x"], expected: "E", actual: "A", evidenceIds: [evidenceId], confidence: 1 } }],
    };
  }

  async function claim(workerId: string, runId: string) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const claimed = await store.claimNextRun(workerId);
      if (!claimed) return undefined;
      if (claimed.id === runId) return claimed;
      await store.failRun(claimed.id, workerId, "leftover from an earlier test");
    }
    return undefined;
  }

  it("keeps a run, its exact plan version, and a queued status across a new connection", async () => {
    const run = await queued();
    expect(await restarted.getRun(run.id)).toMatchObject({ id: run.id, status: "QUEUED", plan: { version: 3, status: "APPROVED" } });
  });

  it("keeps Steps, Evidence, and Bug Drafts readable through a new connection", async () => {
    const run = await queued();
    expect(await claim("w1", run.id)).toBeDefined();
    expect(await store.completeRun(run.id, "w1", failedSnapshot(run.id))).toBe(true);

    expect(await restarted.getRun(run.id)).toMatchObject({ status: "COMPLETED" });
    const outcome = await restarted.readOutcome(run.id);
    expect(outcome).toMatchObject({ result: "FAIL", steps: [{ id: "step-1" }], evidence: [{ id: `evidence-${run.id}` }] });
    expect(await restarted.readBug(`bug-${run.id}`)).toMatchObject({ status: "DRAFT", evidence: [{ id: `evidence-${run.id}` }] });
    expect(await restarted.findEvidence(`evidence-${run.id}`)).toMatchObject({ runId: run.id });
  });

  it("lets only one of many concurrent workers claim a run", async () => {
    const run = await queued();
    const claims = await Promise.all(Array.from({ length: 8 }, (_, index) => store.claimNextRun(`w${index}`)));
    const winners = claims.filter((claimed) => claimed?.id === run.id);
    expect(winners).toHaveLength(1);
  });

  it("rejects completion from a worker that does not own the run, and rolls back a bad outcome", async () => {
    const run = await queued();
    await claim("owner", run.id);
    expect(await store.completeRun(run.id, "intruder", failedSnapshot(run.id))).toBe(false);
    await expect(store.completeRun(run.id, "owner", { ...failedSnapshot(run.id), result: "PASS" })).rejects.toThrow(/aggregate/);
    expect(await store.getRun(run.id)).toMatchObject({ status: "RUNNING" });
    expect(await store.readOutcome(run.id)).toBeUndefined();
  });

  it("fails a run whose heartbeat has gone stale", async () => {
    const run = await queued();
    await claim("gone", run.id);
    await second`UPDATE sentinel_runs SET heartbeat_at = now() - interval '10 minutes' WHERE id = ${run.id}`;
    expect(await store.failStaleRuns(60_000)).toContain(run.id);
    expect(await restarted.getRun(run.id)).toMatchObject({ status: "FAILED", failureReason: "WORKER_LOST" });
  });
});
