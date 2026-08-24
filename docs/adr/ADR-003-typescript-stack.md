# ADR-003: TypeScript Monorepo and Core Stack

- Status: Proposed for human acceptance
- Date: 2026-08-24
- Decision scope: Application language, repository, API, database, and persistence baseline

## Context

Sentinel spans web UI, typed APIs, a browser worker, Playwright, LLM structured output, database contracts, evaluation, and a demo target. Shared types and runtime validation are central. The project should remain understandable and portfolio-ready without adding infrastructure for appearance.

## Options considered

### Language

- TypeScript end-to-end.
- Python backend/agents plus TypeScript frontend.

Python has strong AI tooling, but introduces cross-language contracts and duplicate model/schema definitions. The required Agent workload does not need a Python-only library.

### ORM

- Drizzle.
- Prisma.

Both are viable. Drizzle provides explicit SQL-adjacent schemas and fewer generated abstractions for a persistence-heavy state machine.

### API

- Next.js only.
- Next.js web plus Fastify API and separate Node worker.

Long browser work must not live in a web/serverless request. Separating the API and worker produces a clearer control/data boundary without becoming microservices.

### Workflow

- Explicit TypeScript state machine with PostgreSQL lease/outbox.
- LangGraph.js.
- Temporal from day one.

The MVP transitions are known and need exact persistence. LangGraph is not required merely because LLMs are present. Temporal may be valuable later for long-running distributed workflows but is premature.

## Decision

- pnpm workspace monorepo.
- TypeScript strict across the project.
- Next.js + React for web UI.
- Fastify for typed HTTP API.
- separate Node.js Browser Worker.
- direct Playwright.
- PostgreSQL, compatible with managed/Supabase Postgres.
- Drizzle ORM and migrations.
- Zod schemas as runtime contract source, with JSON Schema/OpenAPI derivation where practical.
- explicit TypeScript state machine and PostgreSQL leases/outbox.
- SSE for live Run events.
- local filesystem artifact adapter first; object-store adapter later.
- `LLMProvider` abstraction with DeepSeek-capable provider and explicitly labelled Mock provider.

Exact dependency versions are selected and pinned in Phase 1 after compatibility checks; Phase 0 does not invent a version matrix.

## Consequences

- UI/API/worker share contracts without sharing privileged implementation.
- Database and state-machine tests can run without an LLM/browser.
- PostgreSQL is required for the realistic app path; lightweight isolated test databases may be used for tests.
- Drizzle is the only ORM. Prisma is not added alongside it.
- API and worker are deployable processes inside one modular system, not independent business microservices.
- If LangGraph/Temporal is introduced, a new ADR must identify a concrete missing capability and migration cost.

## Proposed future workspace

```text
sentinel/
  apps/
    web/
    api/
    worker/
    demo-target/
  packages/
    contracts/
    agent-core/
    browser-executor/
    db/
    llm/
    evaluation/
    shared/
  docs/
  evals/
  tests/
  artifacts/
```

Only `docs/` exists at Phase 0.

## Validation

Phase 1 must prove:

- workspace build/lint/typecheck/test commands;
- shared Zod contracts compile in API and worker;
- Fastify health endpoint;
- PostgreSQL/Drizzle connection and migration test;
- Next.js shell;
- no browser process in API requests;
- Mock Provider clearly labelled in UI/results.

## Revisit when

- a required library is not viable in Node/TypeScript;
- workflow duration/scale justifies Temporal;
- Fastify/Next boundary creates measured duplication;
- ORM limitations block required PostgreSQL behavior.

