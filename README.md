# Sentinel

Sentinel is an AI Release QA Agent for product, engineering, and QA teams. The repository currently contains the **Phase 4 Observer + evidence-bound Bug Detection prototype** plus a local **Sentinel MCP server**: strict structured plans, human plan approval, bounded QA decisions, real Playwright execution, Expected-vs-Actual judgments, failure classification, and read-only Bug Report Drafts.

## Workspace

| Package | Purpose | Default port |
| --- | --- | ---: |
| `apps/web` | New Run, Test Plan review, and read-only Bug Detail UI | 3000 |
| `apps/api` | Fastify plan-review and read-only outcome API | 4000 |
| `apps/worker` | Controlled QA workflow and browser adapter | — |
| `apps/mcp` | High-level MCP tools over the Sentinel API (stdio) | — |
| `apps/demo-target` | TaskForge controlled QA target | 4174 |
| `packages/db` | PostgreSQL URL validation and Drizzle connection | — |
| `packages/browser-runtime` | Deterministic isolated Playwright execution and evidence | — |
| `packages/contracts` | Strict Plan, Decision, Evidence, Assertion, and Bug Report schemas | — |
| `packages/llm` | Real Gateway and visibly marked mock providers | — |
| `packages/agent-core` | Planner, QA Agent, Observer, Bug Reporter task, budgets, and trace | — |

## Local setup

```bash
pnpm install
docker compose up -d --wait
pnpm dev
```

Real planning uses Vercel AI Gateway and requires `AI_GATEWAY_API_KEY`. The default pinned model is `deepseek/deepseek-v4-flash-0731`; override it with `SENTINEL_LLM_MODEL`.

For local UI review without a model key, explicitly set `SENTINEL_LLM_PROVIDER=mock`. Mock plans are labelled `MOCK FIXTURE` in the UI and must not be presented as real AI output.

API contracts:

- `GET /health` checks process liveness without depending on PostgreSQL.
- `GET /ready` checks a real PostgreSQL connection and returns `503` when unavailable.
- `POST /api/v1/runs` creates a run draft.
- `POST /api/v1/runs/:runId/plan` generates or regenerates a plan.
- `PUT /api/v1/runs/:runId/plan` edits the exact current version.
- `POST /api/v1/runs/:runId/plan/approve` approves the exact current version.
- `POST /api/v1/runs/:runId/start` queues only an approved plan; it never launches a browser in the HTTP request.
- `GET /api/v1/runs/:runId` reads lifecycle and the separate QA result.
- `GET /api/v1/runs/:runId/steps` reads Expected, Actual, verdict, confidence, and Evidence IDs.
- `GET /api/v1/runs/:runId/evidence` reads redacted Evidence metadata.
- `GET /api/v1/runs/:runId/bugs` lists Bug Report Drafts.
- `GET /api/v1/bugs/:bugId` reads an evidence-bound Bug Detail.
- `GET /api/v1/evidence/:evidenceId/artifact` reads an allowlisted artifact through the API.

The outcome surface is read-only in Phase 4. GitHub Issue approval/creation and re-test controls are deliberately absent.

## End-to-end demo

Runs now persist in PostgreSQL and a Worker claims queued Runs and executes them in real Chromium. [End-to-end demo](docs/e2e-demo.md) has the local setup and a reproducible passing and failing Run. That demo uses a scripted provider labelled `MOCK FIXTURE`, not a real model.

## MCP server

Start the API first, then let an MCP host launch Sentinel over stdio:

```bash
pnpm dev:mcp
```

The MCP surface contains six high-level workflow tools: create Run, generate Plan, read Run, approve an exact Plan version, start an approved Run, and read a Bug Draft. It deliberately does not expose low-level browser actions, artifact filesystem paths, GitHub Issue writes, or automatic approval.

`sentinel_start_run` only queues the Run; it reports `executionFinished: false`, and a Worker runs it afterwards. Read the outcome with `sentinel_get_run`. See [Sentinel MCP Server](docs/mcp-server.md) for host configuration, boundaries, and current limitations.

TaskForge demo credentials:

```text
qa@taskforge.local
sentinel-demo
```

## TaskForge Break Modes

Select a mode in the UI or pass `?breakMode=<mode>`:

- `none`: normal login and project lifecycle.
- `rename-persistence`: rename looks successful but reverts after refresh.
- `login-failure`: valid demo credentials are rejected.
- `api-500`: project creation returns a visible API 500 failure.
- `slow-network`: login and project mutation wait 900 ms.
- `delete-failure`: deletion looks successful but the project returns after refresh.

## Quality gates

```bash
pnpm build
pnpm lint --max-warnings=0
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:runtime
pnpm test:e2e
```

Run the fixed TaskForge browser spec while the demo target is available:

```bash
SENTINEL_RUN_ID=local-taskforge pnpm --filter @sentinel/worker run:taskforge
```

PowerShell:

```powershell
$env:SENTINEL_RUN_ID = "local-taskforge"
pnpm --filter @sentinel/worker run:taskforge
```

Artifacts are written under `artifacts/runs/<run_id>/`. See [Phase 2 Browser Runtime](docs/phase-2-browser-runtime.md), [Phase 3 Planner + QA Agent](docs/phase-3-planner-qa-agent.md), and [Phase 4 Observer + Bug Detection](docs/phase-4-observer-bug-detection.md) for the implemented boundaries.
