import type { Evidence, TestPlan } from "@sentinel/contracts";
import type { LLMCallMetadata } from "@sentinel/llm";
import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { OutcomeStore, validateSnapshot, type BugDetail, type OutcomeBug, type OutcomeSnapshot } from "./outcome-store";
import { bugDraftsTable, evidenceTable, runsTable, SCHEMA_SQL, stepsTable } from "./schema";

export type RunStatus = "CREATED" | "PLANNING" | "READY" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";

export type RunPlanRecord = {
  status: "DRAFT" | "APPROVED";
  version: number;
  plan: TestPlan;
  provenance: LLMCallMetadata | { provider: "human-edit"; model: "none"; isMock: false };
};

export type RunRecord = {
  id: string;
  targetUrl: string;
  testGoal: string;
  maxSteps: number;
  allowedOrigins: string[];
  status: RunStatus;
  plan?: RunPlanRecord;
  failureReason?: string;
};

export type RunListItem = RunRecord & { result: OutcomeSnapshot["result"] | "NOT_EVALUATED"; createdAt: string };

export type ClaimedRun = RunRecord & { plan: RunPlanRecord };

export interface RunStore {
  createRun(run: RunRecord): Promise<void>;
  getRun(runId: string): Promise<RunRecord | undefined>;
  /** Newest first. */
  listRuns(limit: number): Promise<RunListItem[]>;
  /** Applies a synchronous change under the run's lock. Returns undefined when the run does not exist. */
  mutateRun<T>(runId: string, mutate: (run: RunRecord) => T): Promise<T | undefined>;
  claimNextRun(workerId: string): Promise<ClaimedRun | undefined>;
  heartbeat(runId: string, workerId: string): Promise<boolean>;
  completeRun(runId: string, workerId: string, snapshot: OutcomeSnapshot): Promise<boolean>;
  failRun(runId: string, workerId: string, reason: string): Promise<boolean>;
  /** Fails runs whose worker stopped heartbeating. Browser actions may not be safely repeatable, so they are not requeued. */
  failStaleRuns(staleAfterMs: number): Promise<string[]>;
  readOutcome(runId: string): Promise<OutcomeSnapshot | undefined>;
  readBug(bugId: string): Promise<BugDetail | undefined>;
  findEvidence(evidenceId: string): Promise<Evidence | undefined>;
}

export const RUN_STARTED_STATUSES: readonly RunStatus[] = ["QUEUED", "RUNNING", "COMPLETED", "FAILED"];

export function hasRunStarted(status: RunStatus): boolean {
  return RUN_STARTED_STATUSES.includes(status);
}

type Claim = { workerId: string; heartbeatAt: number; queuedAt: number };

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RunRecord>();
  private readonly claims = new Map<string, Claim>();
  private readonly queue: string[] = [];
  private readonly createdAt = new Map<string, string>();

  constructor(private readonly outcomes = new OutcomeStore(), private readonly now: () => number = Date.now) {}

  async createRun(run: RunRecord): Promise<void> {
    this.runs.set(run.id, structuredClone(run));
    this.createdAt.set(run.id, new Date(this.now()).toISOString());
  }

  async listRuns(limit: number): Promise<RunListItem[]> {
    return [...this.runs.values()].reverse().slice(0, limit).map((run) => ({
      ...structuredClone(run),
      result: this.outcomes.read(run.id)?.result ?? "NOT_EVALUATED",
      createdAt: this.createdAt.get(run.id)!,
    }));
  }

  async getRun(runId: string): Promise<RunRecord | undefined> {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : undefined;
  }

  async mutateRun<T>(runId: string, mutate: (run: RunRecord) => T): Promise<T | undefined> {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    const before = run.status;
    const output = mutate(run);
    if (before !== "QUEUED" && run.status === "QUEUED") this.queue.push(runId);
    return structuredClone(output);
  }

  async claimNextRun(workerId: string): Promise<ClaimedRun | undefined> {
    const runId = this.queue.shift();
    if (!runId) return undefined;
    const run = this.runs.get(runId);
    if (!run?.plan) return undefined;
    run.status = "RUNNING";
    this.claims.set(runId, { workerId, heartbeatAt: this.now(), queuedAt: this.now() });
    return structuredClone(run) as ClaimedRun;
  }

  async heartbeat(runId: string, workerId: string): Promise<boolean> {
    const claim = this.activeClaim(runId, workerId);
    if (!claim) return false;
    claim.heartbeatAt = this.now();
    return true;
  }

  async completeRun(runId: string, workerId: string, snapshot: OutcomeSnapshot): Promise<boolean> {
    if (!this.activeClaim(runId, workerId)) return false;
    this.outcomes.record(snapshot);
    this.runs.get(runId)!.status = "COMPLETED";
    return true;
  }

  async failRun(runId: string, workerId: string, reason: string): Promise<boolean> {
    if (!this.activeClaim(runId, workerId)) return false;
    const run = this.runs.get(runId)!;
    run.status = "FAILED";
    run.failureReason = reason;
    return true;
  }

  async failStaleRuns(staleAfterMs: number): Promise<string[]> {
    const failed: string[] = [];
    for (const [runId, claim] of this.claims) {
      const run = this.runs.get(runId);
      if (run?.status === "RUNNING" && this.now() - claim.heartbeatAt > staleAfterMs) {
        run.status = "FAILED";
        run.failureReason = WORKER_LOST;
        failed.push(runId);
      }
    }
    return failed;
  }

  async readOutcome(runId: string): Promise<OutcomeSnapshot | undefined> {
    return this.outcomes.read(runId);
  }

  async readBug(bugId: string): Promise<BugDetail | undefined> {
    return this.outcomes.readBug(bugId);
  }

  async findEvidence(evidenceId: string): Promise<Evidence | undefined> {
    for (const runId of this.runs.keys()) {
      const evidence = this.outcomes.read(runId)?.evidence.find((item) => item.id === evidenceId);
      if (evidence) return evidence;
    }
    return undefined;
  }

  private activeClaim(runId: string, workerId: string): Claim | undefined {
    const claim = this.claims.get(runId);
    return claim?.workerId === workerId && this.runs.get(runId)?.status === "RUNNING" ? claim : undefined;
  }
}

const WORKER_LOST = "WORKER_LOST";
const MIGRATION_LOCK = 72_401;

export class PostgresRunStore implements RunStore {
  private readonly db;
  private ready: Promise<void> | undefined;

  constructor(private readonly client: postgres.Sql) {
    this.db = drizzle(client);
  }

  /** Creates the tables on first use, so the API stays live while the database is still starting. */
  private ensureSchema(): Promise<void> {
    this.ready ??= this.client
      .begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK})`;
        await tx.unsafe(SCHEMA_SQL);
      })
      .then(() => undefined)
      .catch((error: unknown) => {
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }

  async createRun(run: RunRecord): Promise<void> {
    await this.ensureSchema();
    await this.db.insert(runsTable).values({
      id: run.id,
      targetUrl: run.targetUrl,
      testGoal: run.testGoal,
      maxSteps: run.maxSteps,
      allowedOrigins: run.allowedOrigins,
      status: run.status,
      plan: run.plan ?? null,
    });
  }

  async getRun(runId: string): Promise<RunRecord | undefined> {
    await this.ensureSchema();
    const [row] = await this.db.select().from(runsTable).where(eq(runsTable.id, runId));
    return row ? toRunRecord(row) : undefined;
  }

  async listRuns(limit: number): Promise<RunListItem[]> {
    await this.ensureSchema();
    const rows = await this.db.select().from(runsTable).orderBy(desc(runsTable.createdAt)).limit(limit);
    return rows.map((row) => ({
      ...toRunRecord(row),
      result: (row.result ?? "NOT_EVALUATED") as RunListItem["result"],
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async mutateRun<T>(runId: string, mutate: (run: RunRecord) => T): Promise<T | undefined> {
    await this.ensureSchema();
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(runsTable).where(eq(runsTable.id, runId)).for("update");
      if (!row) return undefined;
      const run = toRunRecord(row);
      const output = mutate(run);
      await tx.update(runsTable).set({
        status: run.status,
        plan: run.plan ?? null,
        failureReason: run.failureReason ?? null,
        updatedAt: sql`now()`,
        ...(row.status !== "QUEUED" && run.status === "QUEUED" ? { queuedAt: sql`now()` } : {}),
      }).where(eq(runsTable.id, runId));
      return output;
    });
  }

  async claimNextRun(workerId: string): Promise<ClaimedRun | undefined> {
    await this.ensureSchema();
    const rows = await this.client<{ id: string }[]>`
      UPDATE sentinel_runs
      SET status = 'RUNNING', claimed_by = ${workerId}, heartbeat_at = now(), started_at = now(), updated_at = now()
      WHERE id = (
        SELECT id FROM sentinel_runs
        WHERE status = 'QUEUED'
        ORDER BY queued_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id`;
    const id = rows[0]?.id;
    if (!id) return undefined;
    const run = await this.getRun(id);
    return run?.plan ? (run as ClaimedRun) : undefined;
  }

  async heartbeat(runId: string, workerId: string): Promise<boolean> {
    await this.ensureSchema();
    const rows = await this.db.update(runsTable)
      .set({ heartbeatAt: sql`now()` })
      .where(ownedBy(runId, workerId))
      .returning({ id: runsTable.id });
    return rows.length === 1;
  }

  async completeRun(runId: string, workerId: string, snapshot: OutcomeSnapshot): Promise<boolean> {
    await this.ensureSchema();
    const outcome = validateSnapshot(structuredClone(snapshot), 0.7);
    return this.db.transaction(async (tx) => {
      const updated = await tx.update(runsTable).set({
        status: "COMPLETED",
        result: outcome.result,
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      }).where(ownedBy(runId, workerId)).returning({ id: runsTable.id });
      if (updated.length !== 1) return false;

      await tx.insert(stepsTable).values(outcome.steps.map((step) => ({
        runId,
        id: step.id,
        sequence: step.sequence,
        description: step.description,
        expected: step.expected,
        assertion: step.assertion,
      })));
      if (outcome.evidence.length > 0) {
        await tx.insert(evidenceTable).values(outcome.evidence.map((item) => ({ runId, id: item.id, stepId: item.stepId, payload: item })));
      }
      if (outcome.bugs.length > 0) {
        await tx.insert(bugDraftsTable).values(outcome.bugs.map((bug) => ({
          id: bug.id,
          runId,
          stepId: bug.stepId,
          revision: bug.revision,
          status: bug.status,
          report: bug.report,
          provenance: bug.provenance,
        })));
      }
      return true;
    });
  }

  async failRun(runId: string, workerId: string, reason: string): Promise<boolean> {
    await this.ensureSchema();
    const rows = await this.db.update(runsTable).set({
      status: "FAILED",
      failureReason: reason,
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    }).where(ownedBy(runId, workerId)).returning({ id: runsTable.id });
    return rows.length === 1;
  }

  async failStaleRuns(staleAfterMs: number): Promise<string[]> {
    await this.ensureSchema();
    const rows = await this.client<{ id: string }[]>`
      UPDATE sentinel_runs
      SET status = 'FAILED', failure_reason = ${WORKER_LOST}, finished_at = now(), updated_at = now()
      WHERE status = 'RUNNING' AND heartbeat_at < now() - make_interval(secs => ${staleAfterMs / 1000})
      RETURNING id`;
    return rows.map((row) => row.id);
  }

  async readOutcome(runId: string): Promise<OutcomeSnapshot | undefined> {
    await this.ensureSchema();
    const [run] = await this.db.select().from(runsTable).where(eq(runsTable.id, runId));
    if (!run?.result) return undefined;
    const [steps, evidence, bugs] = await Promise.all([
      this.db.select().from(stepsTable).where(eq(stepsTable.runId, runId)),
      this.db.select().from(evidenceTable).where(eq(evidenceTable.runId, runId)),
      this.db.select().from(bugDraftsTable).where(eq(bugDraftsTable.runId, runId)),
    ]);
    return {
      runId,
      result: run.result as OutcomeSnapshot["result"],
      steps: steps
        .map(({ id, sequence, description, expected, assertion }) => ({ id, sequence, description, expected, assertion }))
        .sort((left, right) => left.sequence - right.sequence),
      evidence: evidence
        .map((row) => row.payload)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
      bugs: bugs
        .map((bug): OutcomeBug => ({
          id: bug.id,
          runId: bug.runId,
          stepId: bug.stepId,
          revision: bug.revision,
          status: "DRAFT",
          report: bug.report,
          provenance: bug.provenance,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    };
  }

  async readBug(bugId: string): Promise<BugDetail | undefined> {
    await this.ensureSchema();
    const [row] = await this.db.select({ runId: bugDraftsTable.runId }).from(bugDraftsTable).where(eq(bugDraftsTable.id, bugId));
    if (!row) return undefined;
    const outcome = await this.readOutcome(row.runId);
    const bug = outcome?.bugs.find((candidate) => candidate.id === bugId);
    if (!outcome || !bug) return undefined;
    const evidenceById = new Map(outcome.evidence.map((item) => [item.id, item]));
    return {
      ...bug,
      evidence: bug.report.evidenceIds.map((id) => {
        const evidence = evidenceById.get(id);
        if (!evidence) throw new Error(`Bug ${bug.id} references missing evidence ${id}.`);
        return evidence;
      }),
    };
  }

  async findEvidence(evidenceId: string): Promise<Evidence | undefined> {
    await this.ensureSchema();
    const [row] = await this.db.select().from(evidenceTable).where(eq(evidenceTable.id, evidenceId));
    return row?.payload;
  }
}

function ownedBy(runId: string, workerId: string) {
  return and(eq(runsTable.id, runId), eq(runsTable.claimedBy, workerId), eq(runsTable.status, "RUNNING"));
}

function toRunRecord(row: typeof runsTable.$inferSelect): RunRecord {
  return {
    id: row.id,
    targetUrl: row.targetUrl,
    testGoal: row.testGoal,
    maxSteps: row.maxSteps,
    allowedOrigins: row.allowedOrigins,
    status: row.status as RunStatus,
    ...(row.plan ? { plan: row.plan } : {}),
    ...(row.failureReason ? { failureReason: row.failureReason } : {}),
  };
}

const CONNECTION_ERROR_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED"]);

export function isDatabaseConnectionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const { code, cause, errors } = current as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof code === "string" && CONNECTION_ERROR_CODES.has(code)) return true;
    current = cause ?? (Array.isArray(errors) ? errors[0] : undefined);
  }
  return false;
}
