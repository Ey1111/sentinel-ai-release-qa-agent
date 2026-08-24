# Sentinel

Sentinel is an AI Release QA Agent for product, engineering, and QA teams. This repository currently contains the **Phase 2 deterministic foundation**: application shells, a controlled browser-test target, and a fixed-spec Playwright Browser Runtime. Planner, QA Agent, and Observer are intentionally not implemented yet.

## Workspace

| Package | Purpose | Default port |
| --- | --- | ---: |
| `apps/web` | Sentinel Release QA frontend shell | 3000 |
| `apps/api` | Fastify liveness and database readiness API | 4000 |
| `apps/worker` | Idle worker process shell | — |
| `apps/demo-target` | TaskForge controlled QA target | 4174 |
| `packages/db` | PostgreSQL URL validation and Drizzle connection | — |
| `packages/browser-runtime` | Deterministic isolated Playwright execution and evidence | — |

## Local setup

```bash
pnpm install
docker compose up -d --wait
pnpm dev
```

API contracts:

- `GET /health` checks process liveness without depending on PostgreSQL.
- `GET /ready` checks a real PostgreSQL connection and returns `503` when unavailable.

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

Artifacts are written under `artifacts/runs/<run_id>/`. See [Phase 2 Browser Runtime](docs/phase-2-browser-runtime.md) for action, evidence, persistence, and security boundaries.
