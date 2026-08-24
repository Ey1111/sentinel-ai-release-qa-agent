# Sentinel — Reference Repository Analysis

> Phase 0 research artifact  
> Researched: 2026-08-24  
> Status: proposed; requires human review before Phase 1

## 1. Research method and pinned revisions

This document separates:

1. what the reference repositories actually implement;
2. what Sentinel can reuse as an idea;
3. what Sentinel must design differently.

| Repository | Revision | Primary value |
| --- | --- | --- |
| [crislerwin/qa-agent](https://github.com/crislerwin/qa-agent/tree/c9cb81e521f3070d8136e872a5bd9be4e4153d8a) | `c9cb81e` | Observe–Think–Act exploration, findings, SQLite session state |
| [billrichards/qa-agent](https://github.com/billrichards/qa-agent/tree/673f336c6dc0454723ef5affb06feb92daf90da5) | `673f336` | URL/instructions workflow, standard suites, custom steps, reports |
| [nirarad/playwright-ai-qa-agent](https://github.com/nirarad/playwright-ai-qa-agent/tree/8011f1af2c4552444485df9e09b6caed1bd1b6db) | `8011f1a` | Failure artifacts, classification, GitHub issue and healing flow |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp/tree/16cf228d7b02c07f800ec3423f471ec2a42d22a9) | `16cf228` | Accessibility snapshots, browser tool contract, isolation/configuration |

Playwright MCP's release repository states that its current source lives in the Playwright monorepo. Relevant source was therefore also inspected at [microsoft/playwright `d4e1023`](https://github.com/microsoft/playwright/tree/d4e1023f6c03a8dced50eb3db88c2217e7c1a86a/packages/playwright-core/src/tools).

Licensing note: the inspected `crislerwin/qa-agent` root has no LICENSE file. Sentinel must not copy its code unless licensing is clarified. `billrichards` and `nirarad` are MIT-licensed; Playwright MCP is Apache-2.0. The recommendation remains to copy no project wholesale.

## 2. Executive conclusion

The four references solve different slices of the problem:

- `crislerwin` shows an autonomous browser exploration loop, but its main unit is an agent session, not an auditable Expected-vs-Actual release contract.
- `billrichards` has the strongest product entry point: URLs plus plain-English instructions, standard checks, custom steps, live run UX, and structured reports.
- `nirarad` begins after a Playwright test has already failed. It is valuable for evidence-first classification and downstream GitHub workflow, not as Sentinel's runtime QA agent.
- Playwright MCP validates the accessibility-snapshot-and-ref interaction model, but explicitly is not a security boundary and adds a protocol hop Sentinel does not need in its MVP runtime.

Sentinel should combine the ideas without combining the codebases:

`Goal contract → reviewed plan → controlled agent decisions → direct Playwright execution → frozen observation → deterministic-first assertion → evidence-bound bug → approval → issue → regression run`

## 3. crislerwin/qa-agent

### 3.1 Architecture

The core is one `ExploratoryAgent`. It owns the browser/page, model, monitors, session repository, authentication manager, state, and optional test generator/executor.

On a new session it crawls the target to create a URL queue. Each exploration step:

1. observes URL/title and visible interactive/image elements;
2. creates a simplified JSON DOM snapshot;
3. gives the snapshot, queue, visited URLs, recent history, and optional human guidance to the LLM;
4. parses `{action, params, reason}`;
5. executes a small action switch;
6. automatically scans console/network/validation signals after interaction;
7. deduplicates findings and saves AgentState to SQLite.

### 3.2 Relevant files

- Loop, snapshot, action switch, automatic scans, screenshots, dedupe: [`src/agents/exploratory.ts`](https://github.com/crislerwin/qa-agent/blob/c9cb81e521f3070d8136e872a5bd9be4e4153d8a/src/agents/exploratory.ts)
- State and finding contracts: [`src/types/index.ts`](https://github.com/crislerwin/qa-agent/blob/c9cb81e521f3070d8136e872a5bd9be4e4153d8a/src/types/index.ts)
- SQLite JSON state upsert/load: [`src/repositories/session.repository.ts`](https://github.com/crislerwin/qa-agent/blob/c9cb81e521f3070d8136e872a5bd9be4e4153d8a/src/repositories/session.repository.ts)
- Database schema: [`src/database/database.ts`](https://github.com/crislerwin/qa-agent/blob/c9cb81e521f3070d8136e872a5bd9be4e4153d8a/src/database/database.ts)
- Site crawl: [`src/tools/crawler.ts`](https://github.com/crislerwin/qa-agent/blob/c9cb81e521f3070d8136e872a5bd9be4e4153d8a/src/tools/crawler.ts)
- Broken images: [`src/tools/broken-images.ts`](https://github.com/crislerwin/qa-agent/blob/c9cb81e521f3070d8136e872a5bd9be4e4153d8a/src/tools/broken-images.ts)
- Console and page errors: [`src/tools/console-errors.ts`](https://github.com/crislerwin/qa-agent/blob/c9cb81e521f3070d8136e872a5bd9be4e4153d8a/src/tools/console-errors.ts)
- HTTP failures and request failures: [`src/tools/network-errors.ts`](https://github.com/crislerwin/qa-agent/blob/c9cb81e521f3070d8136e872a5bd9be4e4153d8a/src/tools/network-errors.ts)
- Finding-to-test generation: [`src/services/test-generator.ts`](https://github.com/crislerwin/qa-agent/blob/c9cb81e521f3070d8136e872a5bd9be4e4153d8a/src/services/test-generator.ts)
- Report generation: [`src/utils/report.ts`](https://github.com/crislerwin/qa-agent/blob/c9cb81e521f3070d8136e872a5bd9be4e4153d8a/src/utils/report.ts)

### 3.3 Reusable ideas

| Idea | Sentinel adaptation |
| --- | --- |
| Observe–Think–Act | Keep the loop, but insert policy validation before Act and mandatory Assert after the post-action observation. |
| Simplified page context | Use ARIA snapshot plus compact interactive metadata instead of complete HTML. |
| Short memory and loop detection | Store action fingerprints, page epoch, state changes, and deterministic stuck counters. |
| Listener-based telemetry | Attach console/pageerror/request/response listeners when the page is created. Attribute events to a step window. |
| Broken-image detector | Combine missing source, zero natural dimensions, and response status; account for lazy images and tracking pixels. |
| Session resume | Persist after every material transition and explicitly classify safe-continue versus safe-replay. |
| Finding aggregation | Use a stable fingerprint, occurrence table, count, first/last seen, and evidence links. |
| Human guidance | Persist guidance as an audited event; do not rewrite prior decisions. |

### 3.4 Limitations and what not to copy

- The whole agent state is persisted as one JSON blob. This is poor for live trace queries, concurrent leases, schema migration, and step-level audits.
- The LLM emits CSS selectors. Class-based fallbacks can be ambiguous and stale. Sentinel needs short-lived element refs resolved inside the executor.
- Broad crawling is not the same as goal-driven QA. Sentinel must complete the reviewed goal before optional exploration.
- Technical signals are treated too close to bugs. Third-party 404s or expected 401s require correlation and policy.
- Functional finding creation depends heavily on the LLM choosing `record_finding`. Sentinel must assert every planned step regardless of whether the model notices a problem.
- The history type has a result field, but the main step flow does not persist `executeAction()`'s result into it. It does not meet Sentinel's Actual State audit requirement.
- The generated-test prompt targets `@playwright/test`, while the executor invokes `bun test`; this is a contract mismatch Sentinel should avoid.
- Screenshot/scanner failures are best-effort and can be swallowed. Sentinel must surface evidence health and never turn missing evidence into PASS.

## 4. billrichards/qa-agent

### 4.1 Architecture

This project exposes a CLI and web UI. `TestConfig` accepts URLs, focused/explore mode, and optional natural-language instructions. Instructions invoke an AI planner that produces a schema-constrained `TestPlan` containing focus areas, custom actions, assertions, severity, and category. The orchestrator opens Playwright pages and runs standard testers plus those custom steps. Findings are aggregated in a `TestSession` and rendered as console, Markdown, JSON, or PDF.

Standard testers cover keyboard, mouse, forms, accessibility, WCAG, and browser errors. The web layer provides run launch, live output, and past session views.

### 4.2 Relevant files

- Architecture and request flow: [`docs/architecture.md`](https://github.com/billrichards/qa-agent/blob/673f336c6dc0454723ef5affb06feb92daf90da5/docs/architecture.md)
- Orchestrator, focused/explore modes, authentication: [`qa_agent/agent.py`](https://github.com/billrichards/qa-agent/blob/673f336c6dc0454723ef5affb06feb92daf90da5/qa_agent/agent.py)
- Product/run configuration: [`qa_agent/config.py`](https://github.com/billrichards/qa-agent/blob/673f336c6dc0454723ef5affb06feb92daf90da5/qa_agent/config.py)
- Finding, Expected/Actual, plan, session: [`qa_agent/models.py`](https://github.com/billrichards/qa-agent/blob/673f336c6dc0454723ef5affb06feb92daf90da5/qa_agent/models.py)
- Planner prompt, schema, validation: [`qa_agent/ai_planner.py`](https://github.com/billrichards/qa-agent/blob/673f336c6dc0454723ef5affb06feb92daf90da5/qa_agent/ai_planner.py)
- Custom action/assertion execution: [`qa_agent/testers/custom.py`](https://github.com/billrichards/qa-agent/blob/673f336c6dc0454723ef5affb06feb92daf90da5/qa_agent/testers/custom.py)
- Browser error detector: [`qa_agent/testers/errors.py`](https://github.com/billrichards/qa-agent/blob/673f336c6dc0454723ef5affb06feb92daf90da5/qa_agent/testers/errors.py)
- Report structure: [`qa_agent/reporters/markdown.py`](https://github.com/billrichards/qa-agent/blob/673f336c6dc0454723ef5affb06feb92daf90da5/qa_agent/reporters/markdown.py)
- Advisory LLM summary: [`qa_agent/summarizer.py`](https://github.com/billrichards/qa-agent/blob/673f336c6dc0454723ef5affb06feb92daf90da5/qa_agent/summarizer.py)

### 4.3 Reusable ideas

| Idea | Sentinel adaptation |
| --- | --- |
| URL + plain-language instructions | Keep the New Run form simple; hide advanced budgets/auth/domain policy behind Advanced. |
| Structured planner output | Validate twice: model structured output, then deterministic semantic/policy checks. |
| Standard checks plus custom flow | Always-on technical telemetry supplements, but does not replace, goal-specific business assertions. |
| Expected/Actual/reproduction | Make them first-class database fields for PASS, FAIL, and UNCERTAIN. |
| Reliability warnings | Planner flags ambiguous or unverifiable goals before execution. |
| Focused/explore modes | MVP defaults to focused; later exploration has a separate bounded budget. |
| Report layer separation | UI, JSON, Markdown, and Issue Draft all render from the same canonical data. |
| SSE live updates | Use sequenced server events with reconnect, not a complex message bus. |

### 4.4 Limitations and what not to copy

- No findings is not proof that all user goals passed. Sentinel needs explicit coverage and UNCERTAIN/BLOCKED states.
- A planner cannot reliably invent selectors before observing the real page. Plans must contain semantic targets, not CSS.
- Page-centric loops that run all custom steps per URL do not model a continuous multi-page user journey well.
- Expected/Actual should exist on passed steps too, not only on findings.
- Fixed sleeps and universal `networkidle` are unreliable for polling or analytics-heavy apps.
- URL-pattern dedupe alone is not a stable bug identity. Include step intent, assertion signature, error signature, route key, and build occurrence.
- Broad accessibility suites are valuable but are outside Sentinel's business-flow MVP center.

## 5. nirarad/playwright-ai-qa-agent

### 5.1 Architecture

This repository is a post-failure CI pipeline rather than an autonomous browser agent:

1. Playwright Test emits JSON/HTML plus failure screenshot, trace, and video.
2. Context extraction reads failed, timed-out, interrupted, or unexpected results, test source, and attachments.
3. A hybrid classifier returns `BROKEN_LOCATOR`, `REAL_BUG`, `FLAKY`, or `ENV_ISSUE` with confidence and explanation.
4. Strong locator-resolution signatures can lock the category deterministically; the LLM then supplies explanation.
5. A confidence gate controls optional GitHub Issue or locator-healing actions.
6. Issue bodies contain a fingerprint marker; open issues are searched before creation.

### 5.2 Relevant files

- Failure artifact configuration: [`tests/playwright.config.ts`](https://github.com/nirarad/playwright-ai-qa-agent/blob/8011f1af2c4552444485df9e09b6caed1bd1b6db/tests/playwright.config.ts)
- Failure and classification contracts: [`agent/types.ts`](https://github.com/nirarad/playwright-ai-qa-agent/blob/8011f1af2c4552444485df9e09b6caed1bd1b6db/agent/types.ts)
- Results and attachments extraction: [`agent/context.ts`](https://github.com/nirarad/playwright-ai-qa-agent/blob/8011f1af2c4552444485df9e09b6caed1bd1b6db/agent/context.ts)
- Hybrid classification and context trimming: [`agent/classifier.ts`](https://github.com/nirarad/playwright-ai-qa-agent/blob/8011f1af2c4552444485df9e09b6caed1bd1b6db/agent/classifier.ts)
- Confidence gate and action routing: [`agent/orchestrator.ts`](https://github.com/nirarad/playwright-ai-qa-agent/blob/8011f1af2c4552444485df9e09b6caed1bd1b6db/agent/orchestrator.ts)
- Issue formatting and fingerprint dedupe: [`agent/reporter.ts`](https://github.com/nirarad/playwright-ai-qa-agent/blob/8011f1af2c4552444485df9e09b6caed1bd1b6db/agent/reporter.ts)
- Constrained healing PR flow: [`agent/healer.ts`](https://github.com/nirarad/playwright-ai-qa-agent/blob/8011f1af2c4552444485df9e09b6caed1bd1b6db/agent/healer.ts)

### 5.3 Reusable ideas

- Classification must be artifact-first, with evidence supplied rather than inferred.
- Deterministic rules should handle strong technical signatures; LLMs should handle semantic ambiguity.
- Classification needs a strict schema, confidence threshold, repair/failure path, and explicit UNCERTAIN result.
- Large fields should have independent size limits and explicit truncation markers.
- GitHub writes should be disabled by default, idempotent, and linked to retained artifacts.
- A classification failure must be recorded and surfaced to human review, not silently skipped.

### 5.4 Limitations and what not to copy

- It assumes an existing Playwright spec and assertion. Sentinel starts with a natural-language goal.
- Locator healing and automatic PRs are out of scope through Phase 5 and conflict with the MVP's limited authority.
- Locator timeout alone cannot prove selector drift; a failed upstream business action can make an element disappear.
- Its fingerprint includes commit, which prevents duplicate writes per occurrence but is not a stable cross-version bug identity. Sentinel needs separate stable finding and occurrence fingerprints.
- Feature flags can permit direct Issue creation. Sentinel requires an explicit human approval record before every external write.

## 6. microsoft/playwright-mcp

### 6.1 Architecture

Playwright MCP presents Playwright browser capabilities as typed MCP tools. It uses structured accessibility snapshots and exact element refs for interaction, reducing reliance on screenshots or coordinate-based vision. Tool responses can include a new snapshot after an action.

The release repository is a rolled package. Its [`src/README.md`](https://github.com/microsoft/playwright-mcp/blob/16cf228d7b02c07f800ec3423f471ec2a42d22a9/src/README.md) points contributors to the Playwright monorepo source.

Its configuration supports isolated or persistent profiles, context options, capabilities, storage state, output directories, console levels, origin filters, action/navigation/settle timeouts, test-id attribute, snapshot mode, file-access guardrails, and secret-response replacement.

### 6.2 Relevant files

Release repository:

- Product behavior, security warning, tools, CLI flags: [`README.md`](https://github.com/microsoft/playwright-mcp/blob/16cf228d7b02c07f800ec3423f471ec2a42d22a9/README.md)
- Typed public configuration: [`config.d.ts`](https://github.com/microsoft/playwright-mcp/blob/16cf228d7b02c07f800ec3423f471ec2a42d22a9/config.d.ts)
- MCP connection surface: [`index.d.ts`](https://github.com/microsoft/playwright-mcp/blob/16cf228d7b02c07f800ec3423f471ec2a42d22a9/index.d.ts)
- Version/runtime packaging: [`package.json`](https://github.com/microsoft/playwright-mcp/blob/16cf228d7b02c07f800ec3423f471ec2a42d22a9/package.json)

Playwright monorepo source:

- Isolated/persistent/CDP/remote browser creation and trace directories: [`browserFactory.ts`](https://github.com/microsoft/playwright/blob/d4e1023f6c03a8dced50eb3db88c2217e7c1a86a/packages/playwright-core/src/tools/mcp/browserFactory.ts)
- MCP configuration parsing/types: [`config.ts`](https://github.com/microsoft/playwright/blob/d4e1023f6c03a8dced50eb3db88c2217e7c1a86a/packages/playwright-core/src/tools/mcp/config.ts)
- Accessibility snapshot and ref-based actions: [`snapshot.ts`](https://github.com/microsoft/playwright/blob/d4e1023f6c03a8dced50eb3db88c2217e7c1a86a/packages/playwright-core/src/tools/backend/snapshot.ts)
- Network request summaries and details: [`network.ts`](https://github.com/microsoft/playwright/blob/d4e1023f6c03a8dced50eb3db88c2217e7c1a86a/packages/playwright-core/src/tools/backend/network.ts)
- Storage state save/restore: [`storage.ts`](https://github.com/microsoft/playwright/blob/d4e1023f6c03a8dced50eb3db88c2217e7c1a86a/packages/playwright-core/src/tools/backend/storage.ts)

### 6.3 Reusable ideas

| Idea | Sentinel adaptation |
| --- | --- |
| Accessibility snapshot | Primary model view; compact by default, scoped lookup when full snapshot is unnecessary. |
| Element refs | Bind a ref to a page epoch and resolve it inside the executor immediately before action. |
| Typed capabilities | Expose only the minimum browser action set; screenshot/network/storage are distinct capabilities. |
| Isolated sessions | One fresh BrowserContext and temp profile per Run; storage restore is an explicit checkpoint operation. |
| Output directory | One artifact namespace per Run with manifest and hashes. |
| Timeouts | Central policy maps timeout classes to concrete action/navigation/settle limits. Models cannot choose arbitrary timeouts. |
| Origin/file restrictions | Layer executor validation, browser routing, and container egress controls. |
| Snapshot over screenshot | Use screenshot for evidence and visual checks, not default element targeting. |
| Token awareness | Snapshot search/scoping should avoid sending a complete accessibility tree on every model call. |

### 6.4 Limitations and why Sentinel uses direct Playwright

- The README and config comments explicitly say origin/file restrictions and secret replacement are convenience guardrails, not security boundaries. Sentinel still needs DNS/IP validation, redirect checks, container egress, and credential isolation.
- MCP owns tool transport, not Sentinel's Run/Step/Checkpoint/Approval transactions.
- MCP does not define Expected-vs-Actual release semantics or a finding/regression lifecycle.
- A protocol server adds deployment, schema, context, and failure surfaces. Sentinel's worker already owns Playwright and needs exact event correlation and atomic persistence.
- Persistent browser profiles are unsuitable as the default for auditable isolated runs.
- Storage state may contain credentials and must be encrypted/redacted; it must never be placed in an LLM prompt.
- Vision, arbitrary initialization scripts, file upload, network mocking, and broad capabilities are too powerful for Sentinel MVP.

Decision: direct Playwright is the production MVP execution layer. MCP remains a documented future adapter and a source of interaction-contract ideas. See ADR-001.

## 7. Cross-reference mapping

| Sentinel concern | Strongest references | Sentinel addition |
| --- | --- | --- |
| QA decision loop | crislerwin + Playwright MCP | Reviewed goal, page epoch, policy gate, explicit assertion |
| Planner | billrichards | Semantic targets, dependencies, risk, assumptions, no selectors |
| Browser executor | Playwright/Playwright MCP | Direct library adapter, receipts, idempotency, checkpoint hooks |
| Observer | nirarad + Playwright | Deterministic-first PASS/FAIL/UNCERTAIN with evidence IDs |
| Telemetry | crislerwin + billrichards | Step correlation, redaction, noise policy, telemetry health |
| Run state | crislerwin | Normalized relational model, lease, transition version, events |
| Report UX | billrichards | Live trace and every step's Expected/Actual, including PASS |
| Classification | nirarad | Product/automation/flaky/environment/uncertain, human gate |
| Issue write | nirarad | Approval record plus DB ledger unique constraint |
| Regression | generated tests + failure pipeline | Saved reproduction contract linked to a new regression run |

## 8. Sentinel's non-negotiable differences

1. Goal-driven, not random crawl-driven.
2. Every planned step has Expected, frozen Actual, verdict, and evidence references.
3. Browser execution is a deterministic service; an LLM only proposes typed actions.
4. `UNCERTAIN` is valid and blocks a false PASS.
5. Browser content is untrusted data and cannot change system/tool policy.
6. Destructive actions and every external write require policy and approval.
7. Run budgets and retry classes are enforced by workflow code.
8. Evidence is immutable and independently retained from generated reports.
9. Checkpoints distinguish safe continue, safe replay, and unsafe unknown outcome.
10. Bug identity, occurrence, GitHub issue, fix, and regression run form one traceable lifecycle.

## 9. Research conclusion

No reference implements Sentinel's complete product contract. Their best ideas are compatible only when wrapped in Sentinel's own workflow, evidence, safety, and persistence model. The highest-value Phase 1/2 engineering sequence remains: deterministic browser kernel first, agent autonomy later.

