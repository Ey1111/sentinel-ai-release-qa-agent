# ADR-001: Direct Playwright vs Playwright MCP

- Status: Proposed for human acceptance
- Date: 2026-08-24
- Decision scope: Sentinel MVP Browser Runtime

## Context

Sentinel needs real browser control, isolated sessions, accessibility-derived observations, screenshots, console/network capture, storage checkpoints, strict timeouts, artifacts, and exact Run/Step correlation.

Playwright MCP offers typed tools and structured accessibility snapshots. Its release repository and source also show isolated profiles, storage, output, timeouts, and origin/file guardrails. However, its documentation states that MCP itself and its convenience restrictions are not security boundaries. MCP also does not own Sentinel's Expected/Actual, Run transaction, approval, evidence, and recovery contracts.

## Options considered

### A. Playwright MCP as the production Browser Runtime

Pros:

- ready-made browser tool schema;
- accessibility snapshot/ref model;
- supports persistent/isolated browser modes;
- broad ecosystem interoperability.

Cons:

- extra process/protocol and failure boundary;
- tool surface is broader than Sentinel MVP needs;
- Sentinel still needs its own policy, persistence, evidence, and safety boundary;
- harder to atomically correlate internal action IDs, receipts, browser events, and checkpoints;
- snapshot/tool schemas may change independently of Sentinel contracts.

### B. Direct Playwright API behind Sentinel's Browser Executor

Pros:

- smallest control surface;
- exact ownership of BrowserContext, listeners, trace, artifact paths, timeouts, and cleanup;
- direct typed receipts and step correlation;
- easier to enforce page epoch, domain policy, approval, retry, and checkpoint rules;
- no unnecessary transport in the critical path.

Cons:

- Sentinel must design and maintain its own safe tool schemas and ref resolution;
- no automatic MCP interoperability;
- more browser-executor code belongs to the project.

### C. Both from day one

Rejected because it duplicates execution paths and test burden before product value is proven.

## Decision

Use direct Playwright API behind a Sentinel-owned deterministic Browser Executor for MVP production runtime.

Borrow from MCP:

- accessibility snapshot as the primary model-facing view;
- short-lived element refs;
- typed capability separation;
- isolated context, storage-state, output, timeout, and snapshot-scoping ideas.

Keep a future `BrowserAdapter` seam so MCP can be evaluated later for development, interoperability, or comparison. Do not implement that adapter in Phase 0/1 unless required by a new accepted ADR.

## Consequences

- Phase 2 must implement and test the Browser Executor explicitly.
- Safety cannot rely on Playwright/MCP origin allowlists alone; container/network controls remain required.
- Browser commands and receipts become Sentinel contracts in `packages/contracts`.
- MCP version changes do not directly change production action semantics.
- Future MCP support requires parity tests against the direct adapter.

## Validation

Phase 2 spikes must prove:

- stable ARIA/ref interaction for TaskForge;
- action/observation event correlation;
- console/network/trace capture;
- isolated context cleanup;
- domain/redirect enforcement;
- safe checkpoint storage behavior.

## Revisit when

- external clients need a standard MCP browser surface;
- maintaining direct browser schemas costs more than the protocol boundary;
- MCP exposes transactional hooks required by Sentinel;
- parity evaluation demonstrates equal safety, traceability, and lower complexity.

