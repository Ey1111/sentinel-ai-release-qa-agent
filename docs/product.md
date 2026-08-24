# Sentinel — Product Contract

> Product contract for Phase 0. This is not a delivery claim or a market-validation result.

## 1. Summary

Sentinel is an AI Release QA Agent for product, engineering, and QA teams. A user provides a target web URL and a natural-language test goal. Sentinel creates a reviewed test plan, operates a real browser, compares Expected State with Actual State, captures evidence, drafts bugs, and later supports an approved Issue and regression re-test loop.

Sentinel is not a chatbot, crawler, RAG system, or Playwright script generator. Its product value is an auditable software-quality workflow.

## 2. Contacts and decision roles

| Role | Responsibility | Phase 0 owner |
| --- | --- | --- |
| Product owner | User outcomes, scope, acceptance, release decision | Human reviewer |
| Engineering lead | Architecture, implementation quality, recovery | Project team |
| QA owner | Test contracts, known-bug dataset, verdict review | Project team |
| Security reviewer | Browser isolation, credentials, domain policy | Required before production use |

Names are intentionally not invented. They must be assigned by the project owner.

## 3. User

### Primary users

- Product Manager validating critical flows before release.
- QA Engineer reducing repetitive exploratory and regression work.
- Developer needing reproducible, evidence-backed bug reports.
- Small team without a dedicated QA function.

### Job to be done

When a web release is ready, the user wants to describe a business flow in plain language and receive trustworthy evidence about whether that flow works, so the team can act without manually reconstructing every failure.

## 4. Problem

Release acceptance is repetitive but not fully static. Teams repeatedly test login, CRUD, forms, navigation, persistence, and error behavior. Traditional scripted tests are reliable when already authored, but they require selectors, fixtures, assertions, and maintenance before they can cover a new or changing product goal. Pure browser agents can adapt, but often lack explicit expected states, evidence, bounded authority, and recovery.

The product problem is therefore not simply “automate clicks.” It is to combine adaptive planning with deterministic execution and auditable judgement.

## 5. Existing workflow

1. A PM or QA reads a release note or story.
2. They manually translate it into a mental checklist.
3. They open a browser and perform the flow.
4. They compare the result to product intent.
5. On failure, they reproduce it, capture a screenshot, inspect logs/network, estimate severity, and write a bug.
6. A developer fixes the issue.
7. Someone manually reconstructs and reruns the same flow.

This workflow loses context between testing, reporting, and re-testing. Evidence quality and reproduction steps vary by person.

## 6. Pain points

- Repetitive execution consumes PM, QA, and developer time.
- New goals are slower to automate than to describe.
- Failures are reported without enough evidence or exact reproduction steps.
- Browser automation errors are confused with product regressions.
- Test state disappears after worker/browser failure.
- A final report hides how the agent reached its conclusion.
- Bug reporting and regression verification are disconnected.
- Autonomous agents can loop, leave the allowed domain, or perform destructive actions.

## 7. Why this deserves an Agent

The adaptive parts need reasoning:

- turning an open-ended business goal into a sequence of verifiable steps;
- choosing a UI action from the current page rather than a pre-recorded selector;
- handling small UI variations while preserving intent;
- comparing semantic expectations such as “the renamed project remains after refresh” with the observed page state;
- producing a concise report from structured evidence.

The deterministic parts do not need an Agent: browser commands, persistence, budgets, event capture, evidence storage, retry, approval, and Issue creation.

## 8. Why ordinary Playwright tests do not solve everything

Playwright is the correct execution layer and remains the best choice for stable regression tests. It does not, by itself, convert a new natural-language goal into a plan, adapt the next action to an unfamiliar current page, decide whether a semantic product outcome matches intent, or manage human review and bug lifecycle.

Sentinel does not replace Playwright tests. It uses Playwright and can later turn validated reproduction contracts into reviewed regression-test drafts.

## 9. Sentinel solution

Sentinel provides:

- goal-to-plan conversion with structured output;
- human plan review before browser execution;
- direct Playwright execution in an isolated context;
- a live trace of plan, decision, command, observation, assertion, and evidence;
- deterministic-first PASS/FAIL/UNCERTAIN judgement;
- evidence-bound structured bug reports;
- controlled approval for destructive or external writes;
- checkpoints and bounded recovery;
- run history and re-run;
- an evaluation dataset with known normal, bug, adversarial, and tool-failure cases.

## 10. Core user flow

1. User creates a Run with Target URL, Test Goal, limits, allowed domains, and optional auth profile.
2. Planner creates a structured Test Plan.
3. User accepts, edits, or regenerates the plan.
4. Workflow starts an isolated Browser Run.
5. For each plan step, QA Agent sees a compressed page observation and proposes a typed action.
6. Policy validates the action; high-risk action pauses for approval.
7. Browser Executor performs the real action and returns a receipt.
8. Observer compares Expected vs frozen Actual and returns PASS, FAIL, or UNCERTAIN with evidence IDs.
9. On FAIL, deterministic workflow plus structured LLM output creates a Bug Report Draft.
10. User reviews the result. In a later phase, an approved draft may create a GitHub Issue.
11. After a fix, Re-test creates a linked Regression Run using the saved reproduction contract.

## 11. MVP

### Must have

- Target URL and natural-language Test Goal.
- Structured Test Plan and human plan review.
- Planner, QA Execution, and Observer/Critic logical agents only.
- Real Chromium execution through direct Playwright.
- Expected/Actual on every step.
- PASS/FAIL/UNCERTAIN.
- Live Step Trace via SSE.
- Screenshot, console, network-failure, DOM/visible-text, and Playwright-error evidence.
- Structured Bug Report Draft.
- Run history and Re-run.
- Controlled loop, limits, retry classes, and basic checkpoints.
- Demo Target with known break modes.
- Versioned eval cases and real eval report.

### Should have after stable MVP

- GitHub Issue integration with approval and dry-run default.
- Stable finding classification and Issue idempotency.
- Regression re-test lifecycle.
- Token/cost dashboard, prompt versions, CI eval smoke.

## 12. Non-goals

- RAG, vector database, knowledge graph, or A2A.
- Ten or more agents or a large MCP ecosystem.
- Automatic business-code repair or PR merge.
- Unbounded web crawling or cross-domain autonomy.
- Vision-first coordinate interaction.
- Mobile/native-app testing.
- Kubernetes, microservice explosion, or a complex message bus.
- Claims of accuracy, recall, latency, or cost not produced by reproducible evaluation.

## 13. Value propositions

| User | Value |
| --- | --- |
| Product Manager | Convert acceptance intent into a visible, reviewable, evidence-backed run. |
| QA Engineer | Reduce repetitive execution while retaining judgement and review control. |
| Developer | Receive precise Expected/Actual, reproduction steps, and linked artifacts. |
| Small team | Gain a minimum viable release-QA loop without pretending to replace expert QA. |

## 14. Success metrics

No baseline or target result is claimed in Phase 0. Phase 6 will establish measured values.

### Product metrics

- Percentage of runs with a reviewed plan that reach a terminal verdict.
- Median time from Run start to reviewable result.
- Percentage of bug drafts approved without reproduction-step edits.
- Regression re-test completion rate.
- Human intervention rate, segmented by planned approval vs unexpected escalation.

### Quality metrics

- Task Success Rate.
- Step Success Rate.
- Bug Detection Recall on known injected bugs.
- False Positive Rate on normal cases.
- Bug Classification Accuracy.
- Recovery Success Rate.
- Average steps and LLM calls per Run.
- P95 Run latency.
- Tokens and estimated cost per Run.

### Phase 0 success criteria

- Product, architecture, agent/tool boundaries, data, API, safety, evaluation, and ADR contracts exist and agree.
- The design explains evidence, bounded autonomy, prompt-injection handling, recovery, and regression closure.
- Phase 1 is not started until human acceptance.

## 15. Assumptions to validate

- Accessibility snapshots expose enough stable semantics for the TaskForge flows.
- Users will review a generated plan before execution.
- A three-agent logical design is sufficient for MVP quality.
- A deterministic-first Observer reduces false positives compared with LLM-only judgement.
- Direct Playwright gives enough control without requiring MCP in production runtime.
- PostgreSQL lease/outbox is sufficient before a dedicated workflow platform.

## 16. Release framing

- Phase 0: contracts and decisions only.
- Phases 1–2: deterministic product shell, Demo Target, and browser kernel.
- Phases 3–4: reviewed planning, bounded QA Agent, assertion, and bug evidence.
- Phase 5: approval, GitHub, and regression closure.
- Phase 6: reproducible evaluation and production-like controls.

No exact delivery dates are asserted. Each phase requires tests, evidence, and human acceptance before the next phase.

