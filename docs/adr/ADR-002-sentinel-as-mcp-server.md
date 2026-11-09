# ADR-002: Expose Sentinel as an MCP server

- Status: Implemented for local review
- Date: 2026-09-02
- Decision scope: Sentinel client integration boundary

## Context

ADR-001 selected direct Playwright as Sentinel's deterministic browser execution layer. That decision rejected replacing the browser runtime with Playwright MCP; it did not prevent Sentinel from exposing its own product capabilities through MCP.

External hosts should be able to create, review, start, and inspect a Sentinel QA Run without reimplementing Sentinel's policy, evidence, or lifecycle rules. MCP is useful for this interoperability layer, but it must not become a second orchestrator or a way to bypass human review.

## Decision

Add `apps/mcp` as a thin MCP adapter over the existing Sentinel HTTP API.

The first transport is stdio for local hosts. The server exposes high-level workflow tools only:

1. `sentinel_create_run`
2. `sentinel_generate_plan`
3. `sentinel_get_run`
4. `sentinel_approve_plan`
5. `sentinel_start_run`
6. `sentinel_get_bug`

Direct Playwright remains inside `apps/worker` and `packages/browser-runtime`. The MCP host never receives arbitrary selectors, JavaScript execution, raw artifact paths, persistence primitives, retry controls, or direct Issue-creation authority.

`sentinel_start_run` requires an exact approved Plan version. It is marked destructive because the resulting browser workflow can mutate the target application. A queued response is not a test result; clients must read the Run until it reaches a terminal lifecycle state and then inspect the separate `PASS | FAIL | UNCERTAIN` result.

## Consequences

- Existing Web UI and HTTP clients continue to work; MCP is another control-plane adapter.
- Sentinel remains responsible for validation, approval, idempotency, budgets, evidence correlation, and state.
- Tool annotations communicate read-only and destructive intent to compatible hosts but are not security enforcement.
- stdio stdout is reserved for MCP protocol traffic; diagnostics use stderr.
- Remote Streamable HTTP, authentication, tenant isolation, artifact resources, subscriptions, and background MCP tasks are deferred.

## Relationship to ADR-001

There are two distinct boundaries:

```text
MCP host -> Sentinel MCP adapter -> Sentinel API/orchestrator -> deterministic Browser Runtime -> Playwright
```

ADR-001 governs the right-hand browser boundary. ADR-002 governs the left-hand client integration boundary. No alternate browser execution path is introduced.

## Validation

- Protocol-level unit tests connect an MCP client to the server with an in-memory transport.
- A process-level integration test launches the stdio entrypoint and negotiates a real MCP connection.
- Tests verify the exact tool list, structured results, input validation, annotations, and stale/unapproved Plan rejection.

## Revisit when

- Sentinel needs a hosted multi-user MCP endpoint;
- durable Run storage and worker job leasing are implemented;
- OAuth/tenant authorization rules are defined;
- evidence artifacts need MCP resource delivery;
- a real client needs progress subscriptions or MCP task semantics.
