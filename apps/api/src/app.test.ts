import { afterEach, describe, expect, it } from "vitest";
import type { Evidence } from "@sentinel/contracts";
import { MockLLMProvider } from "@sentinel/llm";
import { buildApp } from "./app";
import { OutcomeStore, type OutcomeSnapshot } from "./outcome-store";

const planFixture = {
  schemaVersion: "1" as const,
  title: "Create a project",
  goal: "Create a project and verify it appears in the project list",
  assumptions: ["The user starts signed in"],
  successCriteria: ["The new project is visible in the project list"],
  steps: [
    {
      id: "step-1",
      description: "Open the project creation flow",
      intent: "Reach the new project form",
      expectedState: "A project creation form is visible",
      riskLevel: "LOW" as const,
      dependencies: [],
    },
  ],
};

type EvidenceArtifactReader = (evidence: Evidence) => Promise<{ content: Buffer; contentType: string } | undefined>;

function createApp(fixtures: unknown[] = [], outcomeStore = new OutcomeStore(), readEvidenceArtifact?: EvidenceArtifactReader) {
  return buildApp({
    checkDatabase: async () => true,
    plannerProvider: new MockLLMProvider(fixtures),
    outcomeStore,
    ...(readEvidenceArtifact ? { readEvidenceArtifact } : {}),
  } as Parameters<typeof buildApp>[0]);
}

function recordSingleStepOutcome(store: OutcomeStore, runId: string, result: OutcomeSnapshot["result"]): void {
  const content = result === "PASS" ? "Project Alpha is visible" : result === "FAIL" ? "No projects yet" : "The project list is still loading";
  store.record({
    runId,
    result,
    steps: [{
      id: "step-1",
      sequence: 1,
      description: "Inspect the project list",
      expected: "Project Alpha is visible",
      assertion: {
        schemaVersion: "1",
        status: result,
        expected: "Project Alpha is visible",
        actual: content,
        confidence: result === "UNCERTAIN" ? 0.4 : 0.98,
        evidenceIds: ["evidence-visible"],
        reason: result === "PASS" ? "The expected project is visible." : result === "FAIL" ? "The expected project is absent." : "The page state is inconclusive.",
      },
    }],
    evidence: [{
      schemaVersion: "1",
      id: "evidence-visible",
      runId,
      stepId: "step-1",
      type: "VISIBLE_TEXT",
      content,
      createdAt: "2026-08-31T00:00:00.000Z",
      redactionStatus: "REDACTED",
    }],
    bugs: [],
  });
}

function recordScreenshotOutcome(store: OutcomeStore, runId: string): Evidence {
  const screenshot: Evidence = {
    schemaVersion: "1",
    id: "evidence-screenshot",
    runId,
    stepId: "step-1",
    type: "SCREENSHOT",
    artifactPath: "screenshots/project-list.png",
    sha256: "a".repeat(64),
    createdAt: "2026-08-31T00:00:00.000Z",
    redactionStatus: "NOT_REQUIRED",
  };
  store.record({
    runId,
    result: "PASS",
    steps: [{
      id: "step-1",
      sequence: 1,
      description: "Inspect the project list",
      expected: "Project Alpha is visible",
      assertion: {
        schemaVersion: "1",
        status: "PASS",
        expected: "Project Alpha is visible",
        actual: "Project Alpha is visible",
        confidence: 0.98,
        evidenceIds: [screenshot.id],
        reason: "The expected project is visible.",
      },
    }],
    evidence: [screenshot],
    bugs: [],
  });
  return screenshot;
}

describe("API health contract", () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it("reports liveness without requiring the database", async () => {
    const app = buildApp({ checkDatabase: async () => true });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: "sentinel-api", status: "ok" });
  });

  it("reports database readiness failures as unavailable", async () => {
    const app = buildApp({ checkDatabase: async () => false });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ database: "unavailable", status: "not-ready" });
  });
});

describe("Phase 3 plan review lifecycle", () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it("creates a run and returns a visibly marked draft plan", async () => {
    const app = createApp([planFixture]);
    apps.push(app);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      payload: { targetUrl: "http://127.0.0.1:4174", testGoal: planFixture.goal, maxSteps: 8 },
    });
    expect(created.statusCode).toBe(201);
    const run = created.json();

    const generated = await app.inject({ method: "POST", url: `/api/v1/runs/${run.id}/plan` });
    expect(generated.statusCode).toBe(200);
    expect(generated.json()).toMatchObject({
      status: "DRAFT",
      version: 1,
      plan: planFixture,
      provenance: { provider: "mock", model: "fixture", isMock: true },
    });
  });

  it("refuses to start a run before the current plan version is approved", async () => {
    const app = createApp([planFixture]);
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      payload: { targetUrl: "http://127.0.0.1:4174", testGoal: planFixture.goal, maxSteps: 8 },
    });
    const run = created.json();
    await app.inject({ method: "POST", url: `/api/v1/runs/${run.id}/plan` });

    const response = await app.inject({ method: "POST", url: `/api/v1/runs/${run.id}/start` });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "PLAN_APPROVAL_REQUIRED" });
  });

  it("edits and approves only the exact current plan version", async () => {
    const app = createApp([planFixture]);
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      payload: { targetUrl: "http://127.0.0.1:4174", testGoal: planFixture.goal, maxSteps: 8 },
    });
    const run = created.json();
    await app.inject({ method: "POST", url: `/api/v1/runs/${run.id}/plan` });

    const edited = await app.inject({
      method: "PUT",
      url: `/api/v1/runs/${run.id}/plan`,
      payload: { plan: { ...planFixture, title: "Review and create a project" }, expectedVersion: 1 },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ status: "DRAFT", version: 2 });

    const staleApproval = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.id}/plan/approve`,
      payload: { version: 1 },
    });
    expect(staleApproval.statusCode).toBe(409);
    expect(staleApproval.json()).toEqual({ error: "PLAN_VERSION_CONFLICT" });

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.id}/plan/approve`,
      payload: { version: 2 },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ runStatus: "READY", status: "APPROVED", version: 2 });

    const started = await app.inject({ method: "POST", url: `/api/v1/runs/${run.id}/start` });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({ runStatus: "QUEUED", planVersion: 2 });

    for (const attempt of [
      { method: "POST" as const, url: `/api/v1/runs/${run.id}/plan` },
      { method: "POST" as const, url: `/api/v1/runs/${run.id}/plan/approve`, payload: { version: 2 } },
      { method: "POST" as const, url: `/api/v1/runs/${run.id}/start` },
    ]) {
      expect((await app.inject(attempt)).statusCode).toBe(409);
    }
    expect((await app.inject({ method: "GET", url: `/api/v1/runs/${run.id}` })).json()).toMatchObject({ status: "QUEUED", result: "NOT_EVALUATED" });
    expect((await app.inject({ method: "GET", url: "/api/v1/runs" })).json()).toMatchObject({ runs: [{ id: run.id, status: "QUEUED", result: "NOT_EVALUATED" }] });
  });
});

describe("Phase 4 read-only outcome API", () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it("returns a known unevaluated run with stable empty outcome collections", async () => {
    const app = createApp();
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      payload: { targetUrl: "http://127.0.0.1:4174", testGoal: "Inspect the project list", maxSteps: 4 },
    });
    const run = created.json();

    const runResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${run.id}` });
    expect(runResponse.statusCode).toBe(200);
    expect(runResponse.json()).toEqual({
      ...run,
      result: "NOT_EVALUATED",
      bugCount: 0,
    });

    for (const [resource, collection] of [["steps", "steps"], ["evidence", "evidence"], ["bugs", "bugs"]] as const) {
      const response = await app.inject({ method: "GET", url: `/api/v1/runs/${run.id}/${resource}` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ runId: run.id, result: "NOT_EVALUATED", [collection]: [] });
    }
  });

  it("returns typed not-found errors for unknown run and bug reads", async () => {
    const app = createApp();
    apps.push(app);

    for (const path of [
      "/api/v1/runs/missing-run",
      "/api/v1/runs/missing-run/steps",
      "/api/v1/runs/missing-run/evidence",
      "/api/v1/runs/missing-run/bugs",
    ]) {
      const response = await app.inject({ method: "GET", url: path });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "RUN_NOT_FOUND" });
    }

    const bugResponse = await app.inject({ method: "GET", url: "/api/v1/bugs/missing-bug" });
    expect(bugResponse.statusCode).toBe(404);
    expect(bugResponse.json()).toEqual({ error: "BUG_NOT_FOUND" });
  });

  it("returns a completed PASS outcome without bug drafts", async () => {
    const store = new OutcomeStore();
    const app = createApp([], store);
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      payload: { targetUrl: "http://127.0.0.1:4174", testGoal: "Inspect the project list", maxSteps: 4 },
    });
    const run = created.json();
    recordSingleStepOutcome(store, run.id, "PASS");

    const runResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${run.id}` });
    expect(runResponse.json()).toEqual({ ...run, status: "COMPLETED", result: "PASS", bugCount: 0 });

    const stepsResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${run.id}/steps` });
    expect(stepsResponse.json()).toEqual({
      runId: run.id,
      result: "PASS",
      steps: [{
        id: "step-1",
        sequence: 1,
        description: "Inspect the project list",
        status: "PASSED",
        verdict: "PASS",
        expected: "Project Alpha is visible",
        actual: "Project Alpha is visible",
        confidence: 0.98,
        reason: "The expected project is visible.",
        evidenceIds: ["evidence-visible"],
      }],
    });

    const bugsResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${run.id}/bugs` });
    expect(bugsResponse.json()).toEqual({ runId: run.id, result: "PASS", bugs: [] });
  });

  it("preserves UNCERTAIN without manufacturing a failure or bug", async () => {
    const store = new OutcomeStore();
    const app = createApp([], store);
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      payload: { targetUrl: "http://127.0.0.1:4174", testGoal: "Inspect the project list", maxSteps: 4 },
    });
    const run = created.json();
    recordSingleStepOutcome(store, run.id, "UNCERTAIN");

    const runResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${run.id}` });
    expect(runResponse.json()).toEqual({ ...run, status: "COMPLETED", result: "UNCERTAIN", bugCount: 0 });
    const stepsResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${run.id}/steps` });
    expect(stepsResponse.json()).toMatchObject({ result: "UNCERTAIN", steps: [{ status: "UNCERTAIN", verdict: "UNCERTAIN" }] });
    const bugsResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${run.id}/bugs` });
    expect(bugsResponse.json()).toEqual({ runId: run.id, result: "UNCERTAIN", bugs: [] });
  });

  it("returns a failed run with an evidence-bound DRAFT bug detail", async () => {
    const store = new OutcomeStore();
    const app = createApp([], store);
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      payload: { targetUrl: "http://127.0.0.1:4174", testGoal: "Inspect the project list", maxSteps: 4 },
    });
    const run = created.json();
    const visibleEvidence = {
      schemaVersion: "1" as const,
      id: "evidence-visible",
      runId: run.id,
      stepId: "step-1",
      type: "VISIBLE_TEXT" as const,
      content: "No projects yet",
      createdAt: "2026-08-31T00:00:01.000Z",
      redactionStatus: "REDACTED" as const,
    };
    const screenshotEvidence = {
      schemaVersion: "1" as const,
      id: "evidence-screenshot",
      runId: run.id,
      stepId: "step-1",
      type: "SCREENSHOT" as const,
      artifactPath: "screenshots/project-list.png",
      sha256: "a".repeat(64),
      createdAt: "2026-08-31T00:00:02.000Z",
      redactionStatus: "NOT_REQUIRED" as const,
    };
    const failedAssertion = {
      schemaVersion: "1" as const,
      status: "FAIL" as const,
      expected: "Project Alpha is visible",
      actual: "No projects yet",
      confidence: 0.98,
      evidenceIds: [visibleEvidence.id, screenshotEvidence.id],
      reason: "The expected project is absent.",
    };
    const report = {
      schemaVersion: "1" as const,
      title: "Created project is missing",
      summary: "The completed creation flow did not leave a visible project row.",
      category: "FUNCTIONAL" as const,
      severity: "HIGH" as const,
      classification: "REAL_BUG" as const,
      stepsToReproduce: ["Open the project form", "Create Project Alpha"],
      expected: failedAssertion.expected,
      actual: failedAssertion.actual,
      evidenceIds: [screenshotEvidence.id, visibleEvidence.id],
      confidence: 0.94,
    };
    const provenance = {
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
    const screenshotView = {
      schemaVersion: "1",
      id: "evidence-screenshot",
      runId: run.id,
      stepId: "step-1",
      type: "SCREENSHOT",
      sha256: "a".repeat(64),
      createdAt: "2026-08-31T00:00:02.000Z",
      redactionStatus: "NOT_REQUIRED",
      viewUrl: "/api/v1/evidence/evidence-screenshot/artifact",
    };
    store.record({
      runId: run.id,
      result: "FAIL",
      steps: [{ id: "step-1", sequence: 1, description: "Inspect the project list", expected: failedAssertion.expected, assertion: failedAssertion }],
      evidence: [screenshotEvidence, visibleEvidence],
      bugs: [{ id: "bug-1", runId: run.id, stepId: "step-1", revision: 1, status: "DRAFT", report, provenance }],
    });

    const runResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${run.id}` });
    expect(runResponse.json()).toEqual({ ...run, status: "COMPLETED", result: "FAIL", bugCount: 1 });
    const evidenceResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${run.id}/evidence` });
    expect(evidenceResponse.json()).toEqual({ runId: run.id, result: "FAIL", evidence: [visibleEvidence, screenshotView] });
    expect(evidenceResponse.body).not.toContain("artifactPath");
    const bugsResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${run.id}/bugs` });
    expect(bugsResponse.json()).toEqual({
      runId: run.id,
      result: "FAIL",
      bugs: [{ id: "bug-1", runId: run.id, stepId: "step-1", revision: 1, status: "DRAFT", title: report.title, severity: "HIGH", classification: "REAL_BUG", confidence: 0.94 }],
    });
    const bugResponse = await app.inject({ method: "GET", url: "/api/v1/bugs/bug-1" });
    expect(bugResponse.statusCode).toBe(200);
    expect(bugResponse.json()).toEqual({
      id: "bug-1",
      runId: run.id,
      stepId: "step-1",
      revision: 1,
      status: "DRAFT",
      report,
      provenance,
      evidence: [screenshotView, visibleEvidence],
    });
    expect(bugResponse.body).not.toContain("artifactPath");
  });

  it("serves a known artifact through the injected evidence reader", async () => {
    const store = new OutcomeStore();
    const observedEvidence: Evidence[] = [];
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const app = createApp([], store, async (evidence) => {
      observedEvidence.push(evidence);
      return { content: png, contentType: "image/png" };
    });
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      payload: { targetUrl: "http://127.0.0.1:4174", testGoal: "Inspect the project list", maxSteps: 4 },
    });
    const run = created.json();
    const screenshot = recordScreenshotOutcome(store, run.id);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/evidence/evidence-screenshot/artifact?artifactPath=..%2F..%2Fsecret.txt",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.rawPayload).toEqual(png);
    expect(observedEvidence).toEqual([screenshot]);
  });

  it("returns 404 when no artifact reader is configured", async () => {
    const store = new OutcomeStore();
    const app = createApp([], store);
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      payload: { targetUrl: "http://127.0.0.1:4174", testGoal: "Inspect the project list", maxSteps: 4 },
    });
    const run = created.json();
    recordScreenshotOutcome(store, run.id);

    const response = await app.inject({ method: "GET", url: "/api/v1/evidence/evidence-screenshot/artifact" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "EVIDENCE_ARTIFACT_NOT_FOUND" });
  });

  it("returns 404 when the artifact reader cannot find content", async () => {
    const store = new OutcomeStore();
    const app = createApp([], store, async () => undefined);
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      payload: { targetUrl: "http://127.0.0.1:4174", testGoal: "Inspect the project list", maxSteps: 4 },
    });
    const run = created.json();
    recordScreenshotOutcome(store, run.id);

    const response = await app.inject({ method: "GET", url: "/api/v1/evidence/evidence-screenshot/artifact" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "EVIDENCE_ARTIFACT_NOT_FOUND" });
  });

  it("does not invoke the artifact reader for an unknown evidence ID", async () => {
    const store = new OutcomeStore();
    const observedEvidence: Evidence[] = [];
    const app = createApp([], store, async (evidence) => {
      observedEvidence.push(evidence);
      return { content: Buffer.from("secret"), contentType: "text/plain" };
    });
    apps.push(app);
    await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      payload: { targetUrl: "http://127.0.0.1:4174", testGoal: "Inspect the project list", maxSteps: 4 },
    });

    const response = await app.inject({ method: "GET", url: "/api/v1/evidence/..%2F..%2Fsecret.txt/artifact" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "EVIDENCE_ARTIFACT_NOT_FOUND" });
    expect(observedEvidence).toEqual([]);
  });

  it("does not expose Phase 5 bug mutations", async () => {
    const app = createApp();
    apps.push(app);

    for (const path of [
      "/api/v1/bugs/bug-1/approve",
      "/api/v1/bugs/bug-1/create-issue",
      "/api/v1/bugs/bug-1/retest",
    ]) {
      const response = await app.inject({ method: "POST", url: path });
      expect(response.statusCode).toBe(404);
    }
  });
});
