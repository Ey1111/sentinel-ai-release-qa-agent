# Sentinel — Phase 0 Report

> Phase: Research + Product Contract  
> Date: 2026-08-24  
> Status: Ready for human review; Phase 1 has not started

## A. 本 Phase 完成内容

- 检查当前工作目录和 Git 状态，确认目标 `sentinel` 目录原先不存在。
- 在当前仓库内创建独立 `sentinel/docs` 文档目录，未覆盖根目录已有 `docs/`。
- 按固定提交研究四个参考仓库：
  - `crislerwin/qa-agent` `c9cb81e`；
  - `billrichards/qa-agent` `673f336`；
  - `nirarad/playwright-ai-qa-agent` `8011f1a`；
  - `microsoft/playwright-mcp` `16cf228`，并追踪其实际源码到 `microsoft/playwright` `d4e1023`。
- 输出 Reference Analysis，区分事实、可借鉴思想、限制与 Sentinel 差异。
- 输出 Product Contract，覆盖用户、问题、现有流程、痛点、方案、核心流程、MVP、非目标和成功指标。
- 输出 System Architecture，包含 System、Agent Workflow、Browser Execution、Approval、Run State Machine Mermaid 图。
- 输出三 Agent、Bug Reporter Task、Browser Executor、Observation、Evidence、Policy 和 Prompt Injection 合同。
- 输出 PostgreSQL 逻辑数据模型、约束、artifact 布局和恢复/幂等关系。
- 输出 REST/SSE API 合同、错误模型、状态转换、审批和 GitHub/Regression 接口。
- 输出 Safety 与 Evaluation 合同。
- 输出三份 ADR：Direct Playwright、Workflow First、TypeScript/Drizzle Stack。

Phase 0 设计回答了验收问题：为什么需要 Agent、为什么普通 Playwright 不覆盖全部、为什么只有三 Agent、哪些不是 Agent、Bug 如何由 Evidence 证明、如何限制循环、如何抵抗网页 Prompt Injection、如何形成 Bug → Fix → Re-test、如何真实评测。

## B. 新增/修改文件

仅在新目录 `sentinel/` 下新增：

- `docs/reference-analysis.md`
- `docs/product.md`
- `docs/architecture.md`
- `docs/agent-design.md`
- `docs/data-model.md`
- `docs/api-contract.md`
- `docs/safety.md`
- `docs/evaluation.md`
- `docs/adr/ADR-001-direct-playwright-vs-mcp.md`
- `docs/adr/ADR-002-workflow-first-vs-multi-agent.md`
- `docs/adr/ADR-003-typescript-stack.md`
- `docs/phase-0-report.md`

未修改工作区根目录上一轮已有的 `docs/reference-analysis.md`。

## C. Architecture Changes

本 Phase 没有实现代码或运行时变更，只形成待审批的架构决策：

- 模块化单体控制面 + 独立 Browser Worker。
- Direct Playwright 作为确定性 Browser Execution Layer；MCP 仅保留未来 Adapter seam。
- 只使用 Planner、QA Execution、Observer/Critic 三个逻辑 Agent。
- Bug Reporter 是 structured LLM task + deterministic workflow，不是第四 Agent。
- PostgreSQL + Drizzle 保存规范化状态、lease、outbox、tool ledger。
- SSE 提供带 sequence cursor 的实时 Run Trace。
- 本地 artifact adapter 起步，大对象不进入数据库。
- PASS/FAIL/UNCERTAIN 与 Run lifecycle 分离。
- Workflow 拥有预算、重试、checkpoint、approval 和 idempotency。

## D. Commands Run

研究与检查过程中实际执行：

- `Get-Content -Raw`：读取用户 Master Specification 与所需技能说明。
- `Get-ChildItem -Force`、`git status --short`、`Test-Path`：检查工作区和目标目录冲突。
- GitHub 官方页面浏览：核查四个参考仓库。
- `git ls-remote <repo> HEAD`：锁定四个仓库 HEAD。
- `git clone --depth 1 microsoft/playwright-mcp`：本地源码核查。
- `rg --files`、`rg -n`、`git ls-tree`、`git show HEAD:<path>`：定位并阅读关键实现。
- `apply_patch`：新增所有 Phase 0 Markdown 文档。
- PowerShell 文档验收脚本：检查文件、章节、Mermaid、链接、验收问题和 Phase 1 目录边界。

## E. Tests Run

本 Phase 是文档/设计阶段，没有应用代码，因此未运行 build、lint、typecheck、unit、integration 或 Playwright E2E。未把“没有代码”伪装成测试通过。

运行了 Phase 0 文档合同检查：

- 12 个 Phase 0 文档（包含本 Report）是否存在；
- Markdown code fence 是否成对；
- Mermaid block 数是否满足架构要求；
- 相对链接目标是否存在；
- 九个 Phase 0 验收问题是否有明确覆盖；
- 是否误创建 `apps/`、`packages/`、`evals/`、`tests/`、`artifacts/` 等 Phase 1+ 目录。

## F. Test Results

最终文档验收结果：

```text
Phase0Files                : 12
RequiredMissing            : 0
UnexpectedNonMarkdownFiles : 0
MarkdownFences             : 48
MermaidBlocks              : 6
MissingReportSections      : 0
ConceptsCovered            : 12
BrokenRelativeLinks        : 0
Phase1Directories          : 0
ADRsNotProposed            : 0
LegacyRootDocBytes         : 46773
GitScopeAsExpected         : True
AllChecksPassed            : True
```

该结果只证明文档合同的结构完整性，不证明未来产品、Agent 或浏览器运行时正确。

## G. Screenshots / Artifacts

- 无产品截图：Phase 0 没有 UI 或 Browser Runtime。
- 无伪造 trace、screenshot、GitHub Issue 或 eval result。
- 研究 artifact 即本目录 Markdown 文档和其中固定 commit 链接。

## H. Known Issues

- Phase 0 ADR 状态仍为 Proposed，需人工验收后才能作为 Phase 1 实施依据。
- 尚未选择并兼容性验证 Node、Next.js、Playwright 等精确版本。
- SSRF/DNS rebinding、artifact encryption、retention、secret store 仍需 Phase 1/2 spike。
- 用户/项目/多租户模型尚未最终决定。
- 未实现真实 GitHub authentication 或 Issue adapter；属于 Phase 5。
- 未产生任何真实 eval 数字；属于 Phase 6。
- `crislerwin/qa-agent` 核查快照未见 LICENSE，禁止代码复制直到授权明确。

## I. Technical Debt

当前没有代码技术债。已记录的设计债：

- 需要把文档中的 TypeScript 合同转成单一 Zod schema source，避免接口漂移。
- 需要决定 plan revision 第一版表结构。
- 需要定义具体 noise policy 和 deterministic assertion vocabulary。
- 需要验证 accessibility snapshot/ref 对 TaskForge 的稳定性和 token 体积。
- 需要设计 artifact key management 和 secret-redaction 测试集。
- 需要为状态转换、idempotency 和 unknown outcome 建立形式化测试矩阵。

## J. 未完成内容

以下内容有意未开始：

- Monorepo/bootstrap。
- Next.js/Fastify/Worker 代码。
- PostgreSQL schema/migrations。
- TaskForge Demo Target 和 Break Modes。
- Browser Executor。
- LLMProvider、MockProvider 和任何 Agent prompt。
- UI、SSE、GitHub、Regression、Eval dataset/results。

它们均属于 Phase 1–6，当前不允许推进。

## K. 下一 Phase 建议

只有收到人工明确回复 `Phase 0 验收通过` 后，才进入 Phase 1。

建议人工重点 Review：

1. Direct Playwright vs MCP 决策；
2. 三 Agent 与 deterministic workflow 边界；
3. Run status/result 分离；
4. Destructive action 与 plan approval 是否足够严格；
5. PostgreSQL + Drizzle、Fastify/API + 独立 Worker 选择；
6. MVP Must/Should 的阶段归属；
7. Evaluation 的 gold case 和指标定义。

若验收通过，Phase 1 仅做 Project Bootstrap + TaskForge Demo Target，并在 build/lint/typecheck/unit/E2E 后再次停止。

**STOP — 等待人工 Phase 0 验收。**
