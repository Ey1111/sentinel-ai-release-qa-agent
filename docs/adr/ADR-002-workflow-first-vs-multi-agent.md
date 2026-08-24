# ADR-002: Workflow First vs Multi-Agent Orchestration

- Status: Proposed for human acceptance
- Date: 2026-08-24
- Decision scope: Agent orchestration and authority

## Context

Sentinel combines open-ended reasoning with high-consequence browser and external actions. The Master Specification limits the MVP to Planner, QA Execution, and Observer/Critic. Persistence, retry, timeout, evidence, approval, and Issue creation must be deterministic.

A multi-agent architecture could assign separate agents to browsing, observing, classifying, reporting, recovering, and issuing. That increases model calls and makes ownership of state and side effects unclear.

## Options considered

### A. Workflow-first with three logical Agents

- deterministic state machine owns ordering, budgets, persistence, retry, checkpoints, and approval;
- Planner creates the plan;
- QA Execution proposes context-dependent actions;
- Observer/Critic handles semantic judgement;
- Bug Reporter is one structured task inside workflow code.

### B. Multi-agent team with autonomous handoffs

Pros:

- conceptual specialization;
- potentially independent prompt tuning.

Cons:

- more calls, latency, tokens, and failure modes;
- handoffs duplicate context and lose evidence provenance;
- unclear final authority for PASS/FAIL and side effects;
- harder deterministic tests and recovery;
- creates agents for tasks better expressed as code.

### C. No Agent, generated Playwright scripts only

Rejected because it cannot adapt action selection to the current page without first authoring and maintaining a full script; it also misses the product's natural-language and semantic judgement goals.

## Decision

Adopt workflow-first orchestration with exactly three logical Agents in MVP.

The state machine calls Agents as bounded functions. Agents do not message each other directly. All communication passes through validated stored contracts.

Bug Report generation is not an Agent. Browser Executor, Observation Builder, Telemetry, Evidence, Policy, Persistence, Approval, GitHub, Retry, and Checkpoint are deterministic components.

## Consequences

- The orchestrator is a critical domain module and needs state-transition tests.
- Agent prompts remain smaller and role-specific.
- PASS/FAIL/UNCERTAIN provenance is explicit.
- Human and system events can pause/resume without keeping an Agent process alive.
- New “agent” proposals require an ADR showing why deterministic workflow or an existing role cannot own the responsibility.

## Why three Agents

- Planning operates before page execution and needs goal decomposition.
- Runtime action choice needs current-page semantics and recent receipts.
- Semantic assertion should be independent of the action chooser to reduce self-justification.
- Reporting can transform verified structured evidence without ongoing autonomy.

## Validation

- Mock Provider can deterministically run every transition.
- An invalid Agent output cannot cause a tool call.
- A Critic cannot override deterministic assertion failure.
- Budget/approval/retry policies work with no live LLM.
- Prompt injection in page content cannot alter workflow state or authority.

## Revisit when

- evaluation shows a distinct reasoning task cannot be handled reliably by current roles;
- a new role reduces measured error/cost enough to justify operational complexity;
- the workflow engine becomes a bottleneck for a proven product requirement.

