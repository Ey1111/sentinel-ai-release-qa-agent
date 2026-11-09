import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { PlannerAgent } from "@sentinel/agent-core";
import { validateTestPlan, type Evidence } from "@sentinel/contracts";
import { hasRunStarted, InMemoryRunStore, isDatabaseConnectionError, type RunRecord, type RunStore } from "@sentinel/db";
import type { LLMProvider } from "@sentinel/llm";
import type { OutcomeStep, OutcomeStore } from "./outcome-store";

type EvidenceArtifact = { content: Buffer; contentType: string };

type AppDependencies = {
  checkDatabase: () => Promise<boolean>;
  plannerProvider?: LLMProvider;
  store?: RunStore;
  outcomeStore?: OutcomeStore;
  readEvidenceArtifact?: (evidence: Evidence) => Promise<EvidenceArtifact | undefined> | EvidenceArtifact | undefined;
};

export function buildApp(dependencies: AppDependencies) {
  const app = Fastify({ logger: false });
  const store = dependencies.store ?? new InMemoryRunStore(dependencies.outcomeStore);

  app.setErrorHandler((error, _request, reply) => {
    if (isDatabaseConnectionError(error)) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    if (typeof (error as { statusCode?: unknown }).statusCode === "number" && (error as { statusCode: number }).statusCode < 500) {
      return reply.send(error);
    }
    return reply.code(500).send({ error: "INTERNAL_ERROR" });
  });

  app.get("/health", async () => ({ service: "sentinel-api", status: "ok" }));
  app.get("/ready", async (_request, reply) => {
    const available = await dependencies.checkDatabase();
    if (!available) {
      return reply.code(503).send({ database: "unavailable", status: "not-ready" });
    }
    return { database: "available", status: "ready" };
  });

  app.post<{ Body: { targetUrl?: string; testGoal?: string; maxSteps?: number } }>("/api/v1/runs", async (request, reply) => {
    const { targetUrl, testGoal, maxSteps = 12 } = request.body ?? {};
    if (!targetUrl || !testGoal || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 50) {
      return reply.code(400).send({ error: "INVALID_RUN_INPUT" });
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      return reply.code(400).send({ error: "INVALID_TARGET_URL" });
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return reply.code(400).send({ error: "INVALID_TARGET_URL" });
    }
    const run: RunRecord = {
      id: randomUUID(),
      targetUrl,
      testGoal,
      maxSteps,
      allowedOrigins: [parsedUrl.origin],
      status: "CREATED",
    };
    await store.createRun(run);
    return reply.code(201).send(runView(run));
  });

  app.get("/api/v1/runs", async () => {
    const runs = await store.listRuns(100);
    return { runs: runs.map((run) => ({ ...runView(run), result: run.result, createdAt: run.createdAt })) };
  });

  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId", async (request, reply) => {
    const run = await store.getRun(request.params.runId);
    if (!run) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    const outcome = await store.readOutcome(run.id);
    return {
      ...runView(run),
      ...(outcome ? { status: "COMPLETED" as const } : {}),
      result: outcome?.result ?? "NOT_EVALUATED",
      bugCount: outcome?.bugs.length ?? 0,
      ...(run.failureReason ? { failureReason: run.failureReason } : {}),
    };
  });

  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId/steps", async (request, reply) => {
    const run = await store.getRun(request.params.runId);
    if (!run) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    const outcome = await store.readOutcome(run.id);
    return { runId: run.id, result: outcome?.result ?? "NOT_EVALUATED", steps: outcome?.steps.map(stepView) ?? [] };
  });

  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId/evidence", async (request, reply) => {
    const run = await store.getRun(request.params.runId);
    if (!run) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    const outcome = await store.readOutcome(run.id);
    return { runId: run.id, result: outcome?.result ?? "NOT_EVALUATED", evidence: outcome?.evidence.map(evidenceView) ?? [] };
  });

  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId/bugs", async (request, reply) => {
    const run = await store.getRun(request.params.runId);
    if (!run) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    const outcome = await store.readOutcome(run.id);
    return {
      runId: run.id,
      result: outcome?.result ?? "NOT_EVALUATED",
      bugs: outcome?.bugs.map((bug) => ({
        id: bug.id,
        runId: bug.runId,
        stepId: bug.stepId,
        revision: bug.revision,
        status: bug.status,
        title: bug.report.title,
        severity: bug.report.severity,
        classification: bug.report.classification,
        confidence: bug.report.confidence,
      })) ?? [],
    };
  });

  app.get<{ Params: { bugId: string } }>("/api/v1/bugs/:bugId", async (request, reply) => {
    const bug = await store.readBug(request.params.bugId);
    if (!bug || !(await store.getRun(bug.runId))) return reply.code(404).send({ error: "BUG_NOT_FOUND" });
    return { ...bug, evidence: bug.evidence.map(evidenceView) };
  });

  app.get<{ Params: { evidenceId: string } }>("/api/v1/evidence/:evidenceId/artifact", async (request, reply) => {
    const evidence = await store.findEvidence(request.params.evidenceId);
    if (!evidence?.artifactPath || !dependencies.readEvidenceArtifact) {
      return reply.code(404).send({ error: "EVIDENCE_ARTIFACT_NOT_FOUND" });
    }

    try {
      const artifact = await dependencies.readEvidenceArtifact(evidence);
      if (!artifact || !Buffer.isBuffer(artifact.content) || !artifact.contentType.trim()) {
        return reply.code(404).send({ error: "EVIDENCE_ARTIFACT_NOT_FOUND" });
      }
      return reply.type(artifact.contentType).send(artifact.content);
    } catch {
      return reply.code(404).send({ error: "EVIDENCE_ARTIFACT_NOT_FOUND" });
    }
  });

  app.get("/api/v1/evidence/*", async (_request, reply) =>
    reply.code(404).send({ error: "EVIDENCE_ARTIFACT_NOT_FOUND" }));

  app.post<{ Params: { runId: string } }>("/api/v1/runs/:runId/plan", async (request, reply) => {
    const runId = request.params.runId;
    const run = await store.getRun(runId);
    if (!run) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    if (hasRunStarted(run.status)) return reply.code(409).send({ error: "RUN_ALREADY_STARTED" });
    if (!dependencies.plannerProvider) return reply.code(503).send({ error: "LLM_PROVIDER_NOT_CONFIGURED" });
    await store.mutateRun(runId, (current) => {
      if (!hasRunStarted(current.status)) current.status = "PLANNING";
    });
    let generated;
    try {
      generated = await new PlannerAgent(dependencies.plannerProvider).generate({
        targetUrl: run.targetUrl,
        testGoal: run.testGoal,
        allowedDomains: run.allowedOrigins,
        maxSteps: run.maxSteps,
      });
    } catch (error) {
      await store.mutateRun(runId, (current) => {
        if (!hasRunStarted(current.status)) current.status = "CREATED";
      });
      return reply.code(422).send({ error: "PLAN_GENERATION_FAILED", message: errorMessage(error) });
    }
    const view = await store.mutateRun(runId, (current) => {
      if (hasRunStarted(current.status)) return undefined;
      current.plan = {
        status: "DRAFT",
        version: (current.plan?.version ?? 0) + 1,
        plan: generated.plan,
        provenance: generated.provenance,
      };
      return planView(current);
    });
    return view ?? reply.code(409).send({ error: "RUN_ALREADY_STARTED" });
  });

  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId/plan", async (request, reply) => {
    const run = await store.getRun(request.params.runId);
    if (!run) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    if (!run.plan) return reply.code(404).send({ error: "PLAN_NOT_FOUND" });
    return planView(run);
  });

  app.put<{ Params: { runId: string }; Body: { plan?: unknown; expectedVersion?: number } }>("/api/v1/runs/:runId/plan", async (request, reply) => {
    const outcome = await store.mutateRun(request.params.runId, (run): Rejection | { view: ReturnType<typeof planView> } => {
      if (hasRunStarted(run.status)) return reject(409, "RUN_ALREADY_STARTED");
      if (!run.plan) return reject(404, "PLAN_NOT_FOUND");
      if (request.body?.expectedVersion !== run.plan.version) return reject(409, "PLAN_VERSION_CONFLICT");
      const validation = validateTestPlan(request.body.plan, { maxSteps: run.maxSteps });
      if (!validation.ok) return reject(400, "INVALID_TEST_PLAN", validation.errors);
      run.status = "PLANNING";
      run.plan = {
        status: "DRAFT",
        version: run.plan.version + 1,
        plan: validation.plan,
        provenance: { provider: "human-edit", model: "none", isMock: false },
      };
      return { view: planView(run) };
    });
    if (!outcome) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    if ("rejected" in outcome) return reply.code(outcome.statusCode).send(outcome.rejected);
    return outcome.view;
  });

  app.post<{ Params: { runId: string }; Body: { version?: number } }>("/api/v1/runs/:runId/plan/approve", async (request, reply) => {
    const outcome = await store.mutateRun(request.params.runId, (run): Rejection | { view: ReturnType<typeof planView> } => {
      if (hasRunStarted(run.status)) return reject(409, "RUN_ALREADY_STARTED");
      if (!run.plan) return reject(409, "PLAN_APPROVAL_REQUIRED");
      if (request.body?.version !== run.plan.version) return reject(409, "PLAN_VERSION_CONFLICT");
      run.plan.status = "APPROVED";
      run.status = "READY";
      return { view: planView(run) };
    });
    if (!outcome) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    if ("rejected" in outcome) return reply.code(outcome.statusCode).send(outcome.rejected);
    return outcome.view;
  });

  app.post<{ Params: { runId: string } }>("/api/v1/runs/:runId/start", async (request, reply) => {
    const outcome = await store.mutateRun(request.params.runId, (run): Rejection | { runId: string; runStatus: string; planVersion: number } => {
      if (!run.plan || run.plan.status !== "APPROVED" || run.status !== "READY") return reject(409, "PLAN_APPROVAL_REQUIRED");
      run.status = "QUEUED";
      return { runId: run.id, runStatus: run.status, planVersion: run.plan.version };
    });
    if (!outcome) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    if ("rejected" in outcome) return reply.code(outcome.statusCode).send(outcome.rejected);
    return reply.code(202).send(outcome);
  });
  return app;
}

type Rejection = { rejected: { error: string; details?: string[] }; statusCode: number };

function reject(statusCode: number, error: string, details?: string[]): Rejection {
  return { statusCode, rejected: { error, ...(details ? { details } : {}) } };
}

function runView(run: RunRecord) {
  return {
    id: run.id,
    targetUrl: run.targetUrl,
    testGoal: run.testGoal,
    maxSteps: run.maxSteps,
    allowedOrigins: run.allowedOrigins,
    status: run.status,
  };
}

function planView(run: RunRecord) {
  if (!run.plan) throw new Error("Plan view requested before a plan exists");
  return { ...run.plan, runId: run.id, runStatus: run.status };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function stepView(step: OutcomeStep) {
  return {
    id: step.id,
    sequence: step.sequence,
    description: step.description,
    status: step.assertion.status === "PASS" ? "PASSED" : step.assertion.status === "FAIL" ? "FAILED" : "UNCERTAIN",
    verdict: step.assertion.status,
    expected: step.assertion.expected,
    actual: step.assertion.actual,
    confidence: step.assertion.confidence,
    reason: step.assertion.reason,
    evidenceIds: step.assertion.evidenceIds,
  };
}

function evidenceView(evidence: Evidence): Omit<Evidence, "artifactPath"> & { viewUrl?: string } {
  const { artifactPath, ...view } = evidence;
  return artifactPath
    ? { ...view, viewUrl: `/api/v1/evidence/${encodeURIComponent(evidence.id)}/artifact` }
    : view;
}
