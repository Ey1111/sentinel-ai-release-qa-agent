import type { ClaimedRun, OutcomeSnapshot, RunStore } from "@sentinel/db";

export type ExecutionOutcome =
  | { kind: "COMPLETED"; snapshot: OutcomeSnapshot }
  | { kind: "FAILED"; reason: string };

export type RunWorkerOptions = {
  store: RunStore;
  workerId: string;
  execute: (run: ClaimedRun) => Promise<ExecutionOutcome>;
  heartbeatMs?: number;
  staleAfterMs?: number;
  log?: (message: string) => void;
};

export class RunWorker {
  private readonly heartbeatMs: number;
  private readonly staleAfterMs: number;
  private readonly log: (message: string) => void;

  constructor(private readonly options: RunWorkerOptions) {
    this.heartbeatMs = options.heartbeatMs ?? 5_000;
    this.staleAfterMs = options.staleAfterMs ?? 60_000;
    this.log = options.log ?? (() => undefined);
  }

  /** Runs at most one queued Run. Returns false when the queue was empty. */
  async tick(): Promise<boolean> {
    const { store, workerId, execute } = this.options;
    for (const runId of await store.failStaleRuns(this.staleAfterMs)) this.log(`run ${runId} failed: WORKER_LOST`);

    const run = await store.claimNextRun(workerId);
    if (!run) return false;
    this.log(`run ${run.id} claimed`);

    const heartbeat = setInterval(() => {
      store.heartbeat(run.id, workerId).catch(() => this.log(`run ${run.id} heartbeat failed`));
    }, this.heartbeatMs);
    try {
      const outcome = await execute(run).catch((error: unknown): ExecutionOutcome => ({ kind: "FAILED", reason: `EXECUTOR_ERROR: ${describe(error)}` }));
      if (outcome.kind === "COMPLETED") {
        try {
          await store.completeRun(run.id, workerId, outcome.snapshot);
          this.log(`run ${run.id} completed: ${outcome.snapshot.result}`);
        } catch (error) {
          await store.failRun(run.id, workerId, `OUTCOME_REJECTED: ${describe(error)}`);
          this.log(`run ${run.id} failed: outcome rejected`);
        }
      } else {
        await store.failRun(run.id, workerId, outcome.reason);
        this.log(`run ${run.id} failed: ${outcome.reason}`);
      }
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
}

function describe(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown error").slice(0, 300);
}
