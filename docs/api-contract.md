# Sentinel — API Contract

> Phase 0 REST/SSE design. All request/response schemas will live in `packages/contracts` and be runtime-validated.

## 1. Conventions

- Base path: `/api/v1`.
- JSON uses camelCase at the API boundary.
- IDs are UUID strings.
- Timestamps are ISO 8601 UTC.
- Mutation endpoints accept `Idempotency-Key` where retry could duplicate intent.
- State-changing operations require an expected version (`If-Match` or body `expectedVersion`).
- Secrets are referenced by auth profile/secret ID and are never returned.
- Pagination uses opaque cursor plus `limit`.
- API never returns raw storage state, tokens, passwords, or unrestricted artifact paths.

## 2. Error envelope

```ts
interface ApiError {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
    requestId: string;
  };
}
```

Representative codes:

`VALIDATION_ERROR`, `INVALID_STATE_TRANSITION`, `VERSION_CONFLICT`, `BUDGET_EXCEEDED`, `DOMAIN_BLOCKED`, `APPROVAL_REQUIRED`, `APPROVAL_EXPIRED`, `RUN_LEASE_CONFLICT`, `ARTIFACT_NOT_FOUND`, `TOOL_UNKNOWN_OUTCOME`, `INTERNAL_ERROR`.

## 3. Run resources

### `POST /api/v1/runs`

Create a Run in `CREATED`.

```ts
interface CreateRunRequest {
  targetUrl: string;
  testGoal: string;
  allowedDomains?: string[];
  authProfileId?: string;
  budgets?: {
    maxSteps?: number;
    maxRetriesPerStep?: number;
    maxLlmCalls?: number;
    maxTokens?: number;
    maxDurationMs?: number;
    maxEstimatedCostMicros?: number;
  };
}
```

Server normalizes Target URL and defaults allowed domains to the target origin only. It performs scheme/host validation before persistence.

Response: `201 RunSummary`.

### `GET /api/v1/runs`

Filters: `status`, `result`, `cursor`, `limit`, `createdAfter`. Returns recent Runs without heavy observations/artifacts.

### `GET /api/v1/runs/:runId`

Returns Run summary, budgets/usage, active plan version, progress, result counts, and links.

### `POST /api/v1/runs/:runId/plan`

Generate or regenerate a plan. Valid states: `CREATED`, or `READY` when creating a new draft revision. Requires expected Run version.

Response: `202` with operation/Run status `PLANNING`; completion is delivered via SSE and visible through GET.

### `GET /api/v1/runs/:runId/plan`

Returns active draft/approved plan and validation warnings.

### `PUT /api/v1/runs/:runId/plan`

Replace a draft plan with a human-edited structured plan. It runs all schema, DAG, risk, and budget validation. Cannot edit an approved plan in place.

### `POST /api/v1/runs/:runId/plan/approve`

Approves exact plan version and payload hash, moves Run to `READY`.

```ts
interface ApprovePlanRequest {
  planId: string;
  planVersion: number;
  expectedRunVersion: number;
}
```

### `POST /api/v1/runs/:runId/start`

Valid only from `READY` with an approved plan. Creates execution steps, initial job lease intent, and transitions to `RUNNING`. `Idempotency-Key` required.

### `POST /api/v1/runs/:runId/pause`

Requests a safe pause. It does not kill the browser mid-side-effect. Response indicates `pauseRequested`; the terminal pause event arrives through SSE.

### `POST /api/v1/runs/:runId/resume`

Valid from `PAUSED`. Server evaluates latest checkpoint and returns recovery mode. `UNSAFE_UNKNOWN` requires a separate approval/recovery decision.

### `POST /api/v1/runs/:runId/cancel`

Requests cancellation. Running command is allowed to reach a receipt or unknown-outcome boundary before cleanup.

## 4. Steps and trace

### `GET /api/v1/runs/:runId/steps`

Returns ordered step summaries with Expected, Actual, status, verdict, timing, attempt/action count, and evidence count.

### `GET /api/v1/runs/:runId/steps/:stepId`

Returns plan contract, decisions, validated browser commands, receipts, observations, assertions, browser signals, and evidence metadata.

### `GET /api/v1/runs/:runId/events`

Historical paginated event list for debugging/export.

### `GET /api/v1/runs/:runId/stream`

SSE stream. Client sends `Last-Event-ID`; server resumes after that monotonic sequence.

Example:

```text
id: 42
event: assertion.recorded
data: {"runId":"...","stepId":"...","status":"FAIL","evidenceIds":["..."]}
```

Heartbeat events do not advance business state. Authorization is rechecked on reconnect.

## 5. Evidence and artifacts

### `GET /api/v1/runs/:runId/evidence`

Filters by `stepId` and `type`. Returns metadata and small redacted inline content.

### `GET /api/v1/evidence/:evidenceId`

Returns metadata. If artifact-backed and authorized, returns a short-lived download/view URL or streams through an authenticated endpoint.

### `GET /api/v1/runs/:runId/artifacts/manifest`

Returns artifact manifest without secret storage state entries unless caller has the required internal permission.

## 6. Bugs

### `GET /api/v1/runs/:runId/bugs`

Returns Bug Report summaries.

### `GET /api/v1/bugs/:bugId`

Returns report revisions, evidence metadata, approvals, Issue link, reproduction spec, and regression Runs.

### `PUT /api/v1/bugs/:bugId`

Human edits a Draft. Creates a new report revision; evidence ownership and secret scan run again.

### `POST /api/v1/bugs/:bugId/approve`

Creates/updates an approval for a specific Issue Draft payload. This does not create an Issue.

### `POST /api/v1/bugs/:bugId/create-issue`

Phase 5. Requires:

- real GitHub integration explicitly enabled;
- repository allowlist;
- approved, unexpired payload hash;
- `Idempotency-Key`;
- no prior successful Tool Ledger entry.

```ts
interface CreateIssueRequest {
  repository: string;
  title: string;
  body: string;
  labels: string[];
  approvalId: string;
  expectedBugRevision: number;
}
```

Default integration mode is dry-run. Dry-run returns the exact payload with `executed: false` and never fabricates an Issue URL.

### `POST /api/v1/bugs/:bugId/retest`

Phase 5. Creates a new `REGRESSION` Run linked to the original Bug, Run, and Reproduction Spec. It does not mutate the original Run.

## 7. Approvals

### `GET /api/v1/approvals`

Filters by Run/status/subject. Shows exact redacted payload, target, risk, expiry, and state version.

### `POST /api/v1/approvals/:approvalId/approve`

Approves exact `payloadHash` and `stateVersion`.

### `POST /api/v1/approvals/:approvalId/reject`

Requires optional comment. State becomes REJECTED and workflow pauses or chooses a safe alternative.

No generic “approve all future actions” endpoint exists.

## 8. Authentication profiles

### `POST /api/v1/auth-profiles`

Creates metadata and sends secret values directly to the configured secret store. Response returns ID, display name, allowed target domains, and timestamps only.

### `GET /api/v1/auth-profiles`

Returns metadata. Secret values are never readable through the API.

Authentication implementation is deferred beyond the Phase 0 contract.

## 9. Evaluation API/CLI boundary

Evaluation is primarily an internal CLI/job, not a public multi-tenant endpoint in MVP. If exposed later:

- fixtures and Mock-provider Runs are explicitly labelled;
- real-model eval requires manual trigger and budget;
- result payload includes case dataset version, model, prompt version, config, and timestamp.

## 10. Health

### `GET /health`

Liveness only; no secrets or dependency details.

### `GET /ready`

Checks database and required control-plane dependencies. Browser availability is reported separately from worker heartbeat, not by launching a browser per request.

## 11. State-transition rules

| Endpoint | Allowed source state | Result |
| --- | --- | --- |
| create Run | n/a | CREATED |
| generate plan | CREATED/READY draft path | PLANNING |
| approve plan | PLANNING/READY draft | READY |
| start | READY | RUNNING |
| pause | RUNNING/WAITING_APPROVAL | PAUSED eventually |
| resume | PAUSED | RUNNING or WAITING_APPROVAL |
| cancel | non-terminal | CANCELLED eventually |
| create Issue | Bug approved; Run may be terminal | Bug PUBLISHED + Issue link |
| retest | Bug has reproduction spec | New CREATED regression Run |

Invalid transition returns `409 INVALID_STATE_TRANSITION`, never a silent no-op except an identical idempotent request with an existing receipt.

## 12. Security and privacy rules

- URL fields are normalized and revalidated on use, including redirects.
- API responses redact credential-like data in arguments, events, evidence, and Bug Reports.
- Artifact URLs are short-lived and authorization-bound.
- GitHub repository and labels are validated against configuration.
- Mutations produce audit events with actor ID and request ID.
- Request/response size limits apply to plans, visible text, DOM extracts, network bodies, and Issue bodies.

## 13. Deferred API questions

- User authentication/session mechanism.
- Project/tenant resource hierarchy.
- Exact artifact streaming versus signed URL behavior.
- Whether plan generation is represented by a general operation resource.
- OpenAPI generation tool and typed-client generation method.

