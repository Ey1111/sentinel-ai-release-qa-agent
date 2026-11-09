import { useEffect, useState } from "react";
import { categoryLabel, classificationLabel, evidenceTypeLabel, severityLabel } from "./labels";

export type EvidenceView = {
  schemaVersion: "1";
  id: string;
  runId: string;
  stepId: string;
  type:
    | "SCREENSHOT"
    | "CONSOLE_ERROR"
    | "NETWORK_FAILURE"
    | "DOM_STATE"
    | "VISIBLE_TEXT"
    | "PLAYWRIGHT_ERROR"
    | "ASSERTION"
    | "TRACE";
  content?: string;
  sha256?: string;
  viewUrl?: string;
  createdAt: string;
  redactionStatus: "NOT_REQUIRED" | "REDACTED" | "REVIEW_REQUIRED";
};

export type BugReportView = {
  schemaVersion: "1";
  title: string;
  summary: string;
  category: "FUNCTIONAL" | "UI" | "NETWORK" | "CONSOLE" | "AUTH" | "AUTOMATION" | "ENVIRONMENT" | "UNKNOWN";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  classification: "REAL_BUG" | "AUTOMATION_ERROR" | "FLAKY" | "ENVIRONMENT_ERROR" | "UNCERTAIN";
  confidence: number;
  expected: string;
  actual: string;
  stepsToReproduce: string[];
  evidenceIds: string[];
};

export type BugDetailResponse = {
  id: string;
  runId: string;
  stepId: string;
  revision: number;
  status: "DRAFT";
  report: BugReportView;
  evidence: EvidenceView[];
  provenance: { provider: string; model: string; isMock: boolean };
};

export type BugReadApi = {
  getBug(bugId: string): Promise<BugDetailResponse>;
};

type BugLoadState =
  | { status: "LOADING" }
  | { status: "LOADED"; bug: BugDetailResponse }
  | { status: "ERROR"; message: string };

export function BugDetail({ bugId, api }: { bugId: string; api: BugReadApi }) {
  const [state, setState] = useState<BugLoadState>({ status: "LOADING" });

  useEffect(() => {
    let active = true;
    setState({ status: "LOADING" });
    void api.getBug(bugId).then(
      (bug) => {
        if (active) setState({ status: "LOADED", bug });
      },
      (error: unknown) => {
        if (active) setState({ status: "ERROR", message: errorText(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [api, bugId]);

  if (state.status === "LOADING") {
    return <section className="bug-card bug-loading" aria-label="缺陷详情"><p role="status">正在加载缺陷报告…</p></section>;
  }
  if (state.status === "ERROR") {
    return <section className="bug-card" aria-label="缺陷详情"><p role="alert" className="error-message">{state.message}</p></section>;
  }

  const { bug } = state;
  const { report } = bug;
  const evidenceById = new Map(bug.evidence.map((evidence) => [evidence.id, evidence]));
  const referencedEvidence = report.evidenceIds.flatMap((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    return evidence ? [evidence] : [];
  });
  const evidenceWarnings = report.evidenceIds.flatMap((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) return [`引用的证据 ${evidenceId} 不可用。`];
    if (evidence.type === "SCREENSHOT" && !evidence.viewUrl) {
      return [`截图证据 ${evidenceId} 没有可查看的地址。`];
    }
    return [];
  });
  return (
    <article className="bug-card" aria-labelledby="bug-title">
      <header className="bug-heading">
        <div>
                    <h2 id="bug-title">{report.title}</h2>
          <p className="bug-summary">{report.summary}</p>
        </div>
        <div className="review-badges">
          {bug.provenance.isMock ? <span className="mock-badge">模拟数据</span> : <span className="model-badge">{bug.provenance.model}</span>}
          <span className="draft-status">草稿</span>
        </div>
      </header>

      <dl className="bug-metadata">
        <div><dt>严重程度</dt><dd className={`severity severity-${report.severity.toLowerCase()}`}>{severityLabel[report.severity]}</dd></div>
        <div><dt>问题归类</dt><dd>{classificationLabel[report.classification]}</dd></div>
        <div><dt>所属领域</dt><dd>{categoryLabel[report.category]}</dd></div>
        <div><dt>置信度</dt><dd>{Math.round(report.confidence * 100)}%</dd></div>
      </dl>

      <div className="assertion-comparison">
        <section className="assertion-panel expected-panel" aria-label="预期状态">
          <h3>预期</h3>
          <p>{report.expected}</p>
        </section>
        <section className="assertion-panel actual-panel" aria-label="实际状态">
          <h3>实际</h3>
          <p>{report.actual}</p>
        </section>
      </div>

      <section className="bug-section" aria-label="复现步骤">
        <h3>复现步骤</h3>
        <ol>{report.stepsToReproduce.map((step) => <li key={step}>{step}</li>)}</ol>
      </section>

      <section className="bug-section" aria-label="证据">
        <div className="evidence-heading"><h3>证据</h3><span>{report.evidenceIds.length} 项关联证据</span></div>
        {evidenceWarnings.length > 0 ? (
          <div className="evidence-warning" role="alert">
            <strong>部分证据不可用</strong>
            <ul>{evidenceWarnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
          </div>
        ) : null}
        <div className="evidence-grid">
          {referencedEvidence.map((evidence, index) => <EvidenceCard key={`${evidence.id}-${index}`} evidence={evidence} bugTitle={report.title} />)}
        </div>
      </section>
    </article>
  );
}

function EvidenceCard({ evidence, bugTitle }: { evidence: EvidenceView; bugTitle: string }) {
  const screenshotUrl = evidence.type === "SCREENSHOT" ? evidence.viewUrl : undefined;
  return (
    <article className="evidence-card">
      <div className="evidence-card-heading"><strong>{evidenceTypeLabel[evidence.type] ?? evidence.type}</strong><span>{evidence.id}</span></div>
      {screenshotUrl ? <img src={screenshotUrl} alt={`${bugTitle} 的截图证据`} /> : null}
      {evidence.content ? <p className="evidence-content">{evidence.content}</p> : null}
    </article>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "无法加载缺陷报告";
}
