import { useEffect, useState } from "react";
import { formatTime, runStatusLabel, verdictLabel } from "./labels";

export type RunListItem = {
  id: string;
  targetUrl: string;
  testGoal: string;
  status: string;
  result: "PASS" | "FAIL" | "UNCERTAIN" | "NOT_EVALUATED";
  createdAt: string;
};

export type RunListApi = { listRuns(): Promise<{ runs: RunListItem[] }> };

export function RunsList({ api, pollMs = 3_000 }: { api: RunListApi; pollMs?: number }) {
  const [runs, setRuns] = useState<RunListItem[]>();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const data = await api.listRuns();
        if (cancelled) return;
        setRuns(data.runs);
        setError("");
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "无法读取运行记录");
      }
      timer = setTimeout(poll, pollMs);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, pollMs]);

  const list = runs ?? [];
  const stats = [
    { label: "全部运行", value: list.length },
    { label: "进行中", value: list.filter((run) => run.status === "QUEUED" || run.status === "RUNNING").length },
    { label: "通过", value: list.filter((run) => run.result === "PASS").length, tone: "pass" },
    { label: "未通过", value: list.filter((run) => run.result === "FAIL").length, tone: "fail" },
  ];

  return (
    <>
      <div className="stat-row">
        {stats.map((item) => <div key={item.label} className="stat"><span>{item.label}</span><strong className={item.tone ?? ""}>{runs ? item.value : "–"}</strong></div>)}
      </div>
      <section className="table-card" aria-label="运行记录">
        {error && <p role="alert" className="error-message">{error}</p>}
        {runs && runs.length === 0 && <div className="empty-table"><p>还没有运行记录</p><a className="button-link" href="?view=new">新建测试</a></div>}
        {!runs && !error && <p className="empty-table" role="status">正在加载…</p>}
        {runs && runs.length > 0 && (
          <table>
            <thead><tr><th>测试目标</th><th>目标网址</th><th>状态</th><th>结论</th><th>创建时间</th></tr></thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td className="goal-cell"><a href={`?runId=${encodeURIComponent(run.id)}`}>{run.testGoal}</a></td>
                  <td className="url-cell">{run.targetUrl}</td>
                  <td><span className={`status-text status-${run.status.toLowerCase()}`}>{runStatusLabel[run.status] ?? run.status}</span></td>
                  <td><span className={`verdict-chip verdict-${run.result.toLowerCase()}`}>{verdictLabel[run.result]}</span></td>
                  <td className="time-cell">{formatTime(run.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
