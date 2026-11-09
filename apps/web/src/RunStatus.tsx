import { useEffect, useState } from "react";
import { failureReasonLabel, runStatusLabel, severityLabel, verdictLabel } from "./labels";

export type RunStepView = {
  id: string;
  sequence: number;
  description: string;
  verdict: "PASS" | "FAIL" | "UNCERTAIN";
  expected: string;
  actual: string;
  reason: string;
};

export type RunBugSummary = { id: string; title: string; severity: string; classification: string };

export type RunStatusResponse = {
  id: string;
  targetUrl: string;
  status: "CREATED" | "PLANNING" | "READY" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  result: "PASS" | "FAIL" | "UNCERTAIN" | "NOT_EVALUATED";
  failureReason?: string;
  isMock: boolean;
  steps: RunStepView[];
  bugs: RunBugSummary[];
};

export type RunReadApi = {
  startRun(runId: string): Promise<{ runId: string }>;
  getRunStatus(runId: string): Promise<RunStatusResponse>;
};

const statusText: Record<RunStatusResponse["status"], string> = {
  CREATED: "等待生成测试计划。",
  PLANNING: "等待审批测试计划。",
  READY: "计划已批准，尚未排队。",
  QUEUED: "排队中，还没有执行进程领取任务，也没有操作浏览器。",
  RUNNING: "正在真实浏览器中执行计划。",
  COMPLETED: "已完成，以下结论来自记录的证据。",
  FAILED: "运行在得出结论前中断了。",
};

const isFinished = (status: RunStatusResponse["status"]) => status === "COMPLETED" || status === "FAILED";

function RunPipeline({ status }: { status: RunStatusResponse["status"] }) {
  const stageState = (stage: "排队" | "执行" | "结论"): string => {
    const finished = isFinished(status);
    if (stage === "排队") return status === "QUEUED" ? "active" : status === "RUNNING" || finished ? "done" : "";
    if (stage === "执行") return status === "RUNNING" ? "active" : finished ? "done" : "";
    return status === "COMPLETED" ? "done" : status === "FAILED" ? "stopped" : "";
  };
  return (
    <ol className="run-pipeline" aria-hidden="true">
      {(["排队", "执行", "结论"] as const).map((stage) => <li key={stage} className={`run-stage ${stageState(stage)}`}>{stage}</li>)}
    </ol>
  );
}

export function RunStatus({ runId, api, pollMs = 1_500 }: { runId: string; api: RunReadApi; pollMs?: number }) {
  const [run, setRun] = useState<RunStatusResponse>();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await api.getRunStatus(runId);
        if (cancelled) return;
        setRun(next);
        setError("");
        if (!isFinished(next.status)) timer = setTimeout(poll, pollMs);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "无法读取这次运行。");
        timer = setTimeout(poll, pollMs);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, runId, pollMs]);

  return (
    <section className="plan-card" aria-labelledby="run-status-heading">
      <div className="review-heading">
        <div><h2 id="run-status-heading">执行进度</h2></div>
        <div className="review-badges">
          {run?.isMock && <span className="mock-badge">模拟数据</span>}
          {run && <span className="version-badge">{runStatusLabel[run.status]}</span>}
        </div>
      </div>
      {error && <p role="alert" className="error-message">{error}</p>}
      {!run && !error && <p>正在加载…</p>}
      {run && (
        <>
          <RunPipeline status={run.status} />
          <p className="run-summary">{statusText[run.status]}</p>
          {run.status === "FAILED" && run.failureReason && <p role="alert" className="error-message">{failureReasonLabel(run.failureReason)}</p>}
          {run.result !== "NOT_EVALUATED" && <p className={`run-verdict ${run.result.toLowerCase()}`}>结论：{verdictLabel[run.result]}</p>}
          {run.steps.length > 0 && (
            <ol className="step-list">
              {run.steps.map((step) => (
                <li key={step.id} className="step-card">
                  <div className="step-index">{String(step.sequence).padStart(2, "0")}</div>
                  <div>
                    <div className="step-title"><strong>{step.description}</strong><span className={`verdict-chip verdict-${step.verdict.toLowerCase()}`}>{verdictLabel[step.verdict]}</span></div>
                    <p>{step.reason}</p>
                    <dl><dt>预期</dt><dd>{step.expected}</dd><dt>实际</dt><dd>{step.actual}</dd></dl>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {run.bugs.length > 0 && (
            <div className="run-bugs">
              <h3>缺陷报告草稿</h3>
              <ul>{run.bugs.map((bug) => <li key={bug.id}><a href={`?bugId=${encodeURIComponent(bug.id)}`}>{bug.title}</a> · {severityLabel[bug.severity] ?? bug.severity}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
