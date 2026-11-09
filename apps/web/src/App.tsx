import { useState, type FormEvent } from "react";
import { BugDetail, type BugReadApi } from "./BugDetail";
import { apiErrorLabel } from "./labels";
import { RunsList, type RunListApi } from "./RunsList";
import { RunStatus, type RunReadApi, type RunStatusResponse } from "./RunStatus";

export type { BugDetailResponse, BugReadApi, BugReportView, EvidenceView } from "./BugDetail";

type PlanStep = {
  id: string;
  description: string;
  intent: string;
  expectedState: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  dependencies: string[];
};

type TestPlan = {
  schemaVersion: "1";
  title: string;
  goal: string;
  assumptions: string[];
  successCriteria: string[];
  steps: PlanStep[];
};

type PlanResponse = {
  runId: string;
  runStatus: string;
  status: "DRAFT" | "APPROVED";
  version: number;
  plan: TestPlan;
  provenance: { provider: string; model: string; isMock: boolean };
};

export type PlanReviewApi = {
  createRun(input: { targetUrl: string; testGoal: string; maxSteps: number }): Promise<{ id: string }>;
  generatePlan(runId: string): Promise<PlanResponse>;
  updatePlan(runId: string, expectedVersion: number, plan: TestPlan): Promise<PlanResponse>;
  approvePlan(runId: string, version: number): Promise<PlanResponse>;
};

const defaultApi: PlanReviewApi = {
  createRun: (input) => request("/api/v1/runs", { method: "POST", body: JSON.stringify(input) }),
  generatePlan: (runId) => request(`/api/v1/runs/${runId}/plan`, { method: "POST" }),
  updatePlan: (runId, expectedVersion, plan) => request(`/api/v1/runs/${runId}/plan`, {
    method: "PUT",
    body: JSON.stringify({ expectedVersion, plan }),
  }),
  approvePlan: (runId, version) => request(`/api/v1/runs/${runId}/plan/approve`, {
    method: "POST",
    body: JSON.stringify({ version }),
  }),
};

const defaultBugApi: BugReadApi = {
  getBug: (bugId) => request(`/api/v1/bugs/${encodeURIComponent(bugId)}`, { method: "GET" }),
};

const defaultRunApi: RunReadApi = {
  startRun: (runId) => request(`/api/v1/runs/${encodeURIComponent(runId)}/start`, { method: "POST" }),
  getRunStatus: async (runId) => {
    const id = encodeURIComponent(runId);
    const [run, plan, steps, bugs] = await Promise.all([
      request<Omit<RunStatusResponse, "isMock" | "steps" | "bugs">>(`/api/v1/runs/${id}`, { method: "GET" }),
      request<PlanResponse>(`/api/v1/runs/${id}/plan`, { method: "GET" }),
      request<Pick<RunStatusResponse, "steps">>(`/api/v1/runs/${id}/steps`, { method: "GET" }),
      request<Pick<RunStatusResponse, "bugs">>(`/api/v1/runs/${id}/bugs`, { method: "GET" }),
    ]);
    return { ...run, isMock: plan.provenance.isMock, steps: steps.steps, bugs: bugs.bugs };
  },
};

const defaultRunListApi: RunListApi = {
  listRuns: () => request("/api/v1/runs", { method: "GET" }),
};

const navItems = [{ label: "运行记录", href: "/" }, { label: "新建测试", href: "?view=new" }];
const riskLabel: Record<PlanStep["riskLevel"], string> = { LOW: "低风险", MEDIUM: "中风险", HIGH: "高风险" };

export function App({ api = defaultApi, bugApi = defaultBugApi, runApi = defaultRunApi, runListApi = defaultRunListApi, bugId: injectedBugId, defaultView = "runs" }: { api?: PlanReviewApi; bugApi?: BugReadApi; runApi?: RunReadApi; runListApi?: RunListApi; bugId?: string; defaultView?: "runs" | "new" }) {
  const bugId = injectedBugId ?? bugIdFromLocation();
  const [activeRunId, setActiveRunId] = useState(runIdFromLocation);
  const view = bugId || activeRunId ? "detail" : viewFromLocation() ?? defaultView;
  const page = bugId ? { title: "缺陷详情", note: "核对判定依据、复现步骤和证据。" } : activeRunId ? { title: "运行详情", note: "查看这次测试的执行进度和判定结果。" } : view === "new" ? { title: "新建测试", note: "描述要验收的流程，审批计划后才会操作浏览器。" } : { title: "运行记录", note: "查看每次发布验收的状态和结论。" };
  const [targetUrl, setTargetUrl] = useState("");
  const [testGoal, setTestGoal] = useState("");
  const [maxSteps, setMaxSteps] = useState(12);
  const [review, setReview] = useState<PlanResponse>();
  const [editing, setEditing] = useState(false);
  const [editedPlan, setEditedPlan] = useState<TestPlan>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createPlan(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const run = await api.createRun({ targetUrl, testGoal, maxSteps });
      setReview(await api.generatePlan(run.id));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    if (!review) return;
    setBusy(true);
    setError("");
    try {
      setReview(await api.generatePlan(review.runId));
      setEditing(false);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!review || !editedPlan) return;
    setBusy(true);
    try {
      setReview(await api.updatePlan(review.runId, review.version, editedPlan));
      setEditing(false);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!review) return;
    setBusy(true);
    try {
      setReview(await api.approvePlan(review.runId, review.version));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function startRun() {
    if (!review) return;
    setBusy(true);
    setError("");
    try {
      const started = await runApi.startRun(review.runId);
      window.history.replaceState({}, "", `?runId=${encodeURIComponent(started.runId)}`);
      setActiveRunId(started.runId);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sentinel-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="返回 Sentinel 首页"><span className="brand-mark">S</span><span>Sentinel</span></a>
        <nav aria-label="主导航">
          {navItems.map((item, index) => <a key={item.label} className={(index === 1) === (view === "new") ? "active" : ""} href={item.href}><NavIcon index={index} />{item.label}</a>)}
        </nav>
        <div className="phase-note"><span>发布验收 Agent</span><small>所有浏览器操作都需先审批计划</small></div>
      </aside>
      <main id="main">
        <header className="page-header"><div>{view === "detail" && <a className="back-link" href="/">← 运行记录</a>}<h1>{page.title}</h1><p>{page.note}</p></div>{view === "runs" && <a className="button-link" href="?view=new">新建测试</a>}</header>
        {bugId ? <BugDetail bugId={bugId} api={bugApi} /> : activeRunId ? <RunStatus runId={activeRunId} api={runApi} /> : view === "runs" ? <RunsList api={runListApi} /> : <>
        <section className="run-card" aria-labelledby="new-run-heading">
          <div className="section-heading"><div><p className="step-label">第 1 步</p><h2 id="new-run-heading">测试范围</h2></div><span className="draft-status">{review?.status === "APPROVED" ? "已批准" : "草稿"}</span></div>
          <form onSubmit={createPlan}>
            <label htmlFor="target-url">目标网址</label>
            <input id="target-url" type="url" required value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} placeholder="https://staging.example.com" />
            <p className="field-help">只测试你有权访问的测试环境或预发环境。</p>
            <label htmlFor="test-goal">测试目标</label>
            <textarea id="test-goal" rows={4} required value={testGoal} onChange={(event) => setTestGoal(event.target.value)} placeholder="例如：登录后创建一个项目，重命名，然后退出登录" />
            <p className="field-help">写清用户要完成的流程，以及怎样算成功。</p>
            <label htmlFor="max-steps">最多浏览器操作数</label>
            <input id="max-steps" type="number" min={1} max={50} value={maxSteps} onChange={(event) => setMaxSteps(Number(event.target.value))} />
            <div className="form-footer"><button type="submit" disabled={busy}>{busy ? "正在生成…" : "生成测试计划"}</button><small>计划批准前不会操作浏览器。</small></div>
          </form>
          {error && <p role="alert" className="error-message">{error}</p>}
        </section>
        {review && (
          <section className="plan-card" aria-labelledby="plan-heading">
            <div className="review-heading">
              <div><p className="step-label">第 2 步 · 人工审批</p>{editing ? <input aria-label="计划标题" value={editedPlan?.title ?? ""} onChange={(event) => setEditedPlan((current) => current ? { ...current, title: event.target.value } : current)} /> : <h2 id="plan-heading">{review.plan.title}</h2>}</div>
              <div className="review-badges"><span className={review.provenance.isMock ? "mock-badge" : "model-badge"}>{review.provenance.isMock ? "模拟数据" : review.provenance.model}</span><span className="version-badge">v{review.version}</span></div>
            </div>
            <div className="plan-summary"><div><h3>前提假设</h3><ul>{review.plan.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3>成功标准</h3><ul>{review.plan.successCriteria.map((item) => <li key={item}>{item}</li>)}</ul></div></div>
            <ol className="step-list">{review.plan.steps.map((step, index) => <li key={step.id} className="step-card"><div className="step-index">{String(index + 1).padStart(2, "0")}</div><div><div className="step-title"><strong>{step.description}</strong><span className={`risk risk-${step.riskLevel.toLowerCase()}`}>{riskLabel[step.riskLevel]}</span></div><p>{step.intent}</p><dl><dt>预期结果</dt><dd>{step.expectedState}</dd></dl></div></li>)}</ol>
            {review.runStatus === "READY" ? <div className="ready-banner"><strong>计划已批准</strong><span>可以开始运行。此时还没有产生任何测试结论。</span><button type="button" onClick={startRun} disabled={busy}>开始运行</button></div> : <div className="review-actions">{editing ? <><button type="button" className="secondary" onClick={() => setEditing(false)}>取消</button><button type="button" onClick={saveEdit} disabled={busy}>保存修改</button></> : <><button type="button" className="secondary" onClick={regenerate} disabled={busy}>重新生成</button><button type="button" className="secondary" onClick={() => { setEditedPlan(structuredClone(review.plan)); setEditing(true); }}>编辑计划</button><button type="button" onClick={approve} disabled={busy}>批准计划</button></>}</div>}
          </section>
        )}
        </>}
      </main>
    </div>
  );
}

function NavIcon({ index }: { index: number }) {
  const paths = [
    "M4 5.5h16M4 12h16M4 18.5h10",
    "M12 5v14M5 12h14",
  ];
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[index]} /></svg>;
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    ...(init.body ? { headers: { "content-type": "application/json", ...init.headers } } : {}),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? (body.error ? apiErrorLabel(body.error) : "请求失败"));
  return body as T;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误";
}

function viewFromLocation(): "new" | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("view") === "new" ? "new" : undefined;
}

function runIdFromLocation(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const runId = new URLSearchParams(window.location.search).get("runId")?.trim();
  return runId || undefined;
}

function bugIdFromLocation(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const bugId = new URLSearchParams(window.location.search).get("bugId")?.trim();
  return bugId || undefined;
}
