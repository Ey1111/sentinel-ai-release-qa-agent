import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { App, type BugReadApi, type PlanReviewApi } from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const planResponse = {
  runId: "run-1",
  runStatus: "PLANNING",
  status: "DRAFT" as const,
  version: 1,
  provenance: { provider: "mock", model: "fixture", isMock: true },
  plan: {
    schemaVersion: "1" as const,
    title: "Create a project",
    goal: "Create a project",
    assumptions: ["The user starts signed in"],
    successCriteria: ["The project appears in the list"],
    steps: [{
      id: "step-1",
      description: "Open project creation",
      intent: "Reach the form",
      expectedState: "The project form is visible",
      riskLevel: "LOW" as const,
      dependencies: [],
    }],
  },
};

const bugDetailResponse = {
  id: "bug-rename-persistence",
  runId: "run-rename-persistence",
  stepId: "step-refresh-project",
  revision: 1,
  status: "DRAFT" as const,
  report: {
    schemaVersion: "1" as const,
    title: "Project name reverts after page refresh",
    summary: "The saved project name is replaced by its previous value after a refresh.",
    category: "FUNCTIONAL" as const,
    severity: "HIGH" as const,
    classification: "REAL_BUG" as const,
    confidence: 0.94,
    expected: "The renamed project remains Project Alpha after refresh.",
    actual: "The project name returned to Project Draft after refresh.",
    stepsToReproduce: [
      "Sign in to TaskForge",
      "Rename Project Draft to Project Alpha",
      "Refresh the project page",
    ],
    evidenceIds: ["evidence-screenshot", "evidence-visible-text", "evidence-network"],
  },
  evidence: [
    {
      schemaVersion: "1" as const,
      id: "evidence-screenshot",
      runId: "run-rename-persistence",
      stepId: "step-refresh-project",
      type: "SCREENSHOT" as const,
      viewUrl: "/fixtures/rename-reverted.png",
      createdAt: "2026-08-31T09:30:00.000Z",
      redactionStatus: "NOT_REQUIRED" as const,
    },
    {
      schemaVersion: "1" as const,
      id: "evidence-visible-text",
      runId: "run-rename-persistence",
      stepId: "step-refresh-project",
      type: "VISIBLE_TEXT" as const,
      content: "Project Draft",
      createdAt: "2026-08-31T09:30:01.000Z",
      redactionStatus: "REDACTED" as const,
    },
    {
      schemaVersion: "1" as const,
      id: "evidence-network",
      runId: "run-rename-persistence",
      stepId: "step-refresh-project",
      type: "NETWORK_FAILURE" as const,
      content: "PATCH /api/projects/project-1 returned 200 before refresh",
      createdAt: "2026-08-31T09:30:02.000Z",
      redactionStatus: "REDACTED" as const,
    },
  ],
  provenance: { provider: "mock", model: "fixture", isMock: true },
};

function api(): PlanReviewApi {
  return {
    createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
    generatePlan: vi.fn().mockResolvedValue(planResponse),
    updatePlan: vi.fn().mockResolvedValue({ ...planResponse, version: 2 }),
    approvePlan: vi.fn().mockResolvedValue({ ...planResponse, status: "APPROVED", runStatus: "READY" }),
  };
}

class TestErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <p role="alert">Bug Detail failed to render</p> : this.props.children;
  }
}

function renderBug(bugId: string, bugApi: BugReadApi) {
  return render(<TestErrorBoundary><App bugId={bugId} bugApi={bugApi} /></TestErrorBoundary>);
}

it("generates and renders a reviewable structured plan with mock provenance", async () => {
  const client = api();
  render(<App api={client} defaultView="new" />);
  fireEvent.change(screen.getByLabelText("目标网址"), { target: { value: "http://127.0.0.1:4174" } });
  fireEvent.change(screen.getByLabelText("测试目标"), { target: { value: "Create a project" } });
  fireEvent.click(screen.getByRole("button", { name: "生成测试计划" }));
  expect(await screen.findByRole("heading", { name: "Create a project" })).toBeInTheDocument();
  expect(screen.getByText("模拟数据")).toBeInTheDocument();
  expect(screen.getByText("The project form is visible")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "批准计划" })).toBeEnabled();
});

it("approves the exact visible plan version and reports READY, not PASS", async () => {
  const client = api();
  render(<App api={client} defaultView="new" />);
  fireEvent.change(screen.getByLabelText("目标网址"), { target: { value: "http://127.0.0.1:4174" } });
  fireEvent.change(screen.getByLabelText("测试目标"), { target: { value: "Create a project" } });
  fireEvent.click(screen.getByRole("button", { name: "生成测试计划" }));
  await screen.findByRole("heading", { name: "Create a project" });
  fireEvent.click(screen.getByRole("button", { name: "批准计划" }));
  expect(await screen.findByText("计划已批准")).toBeInTheDocument();
  expect(client.approvePlan).toHaveBeenCalledWith("run-1", 1);
  expect(screen.queryByText("通过")).not.toBeInTheDocument();
});

it("supports editing and regenerating a draft plan", async () => {
  const client = api();
  render(<App api={client} defaultView="new" />);
  fireEvent.change(screen.getByLabelText("目标网址"), { target: { value: "http://127.0.0.1:4174" } });
  fireEvent.change(screen.getByLabelText("测试目标"), { target: { value: "Create a project" } });
  fireEvent.click(screen.getByRole("button", { name: "生成测试计划" }));
  await screen.findByRole("heading", { name: "Create a project" });
  fireEvent.click(screen.getByRole("button", { name: "编辑计划" }));
  fireEvent.change(screen.getByLabelText("计划标题"), { target: { value: "Review and create a project" } });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  expect(client.updatePlan).toHaveBeenCalledWith("run-1", 1, expect.objectContaining({ title: "Review and create a project" }));
  fireEvent.click(await screen.findByRole("button", { name: "重新生成" }));
  expect(client.generatePlan).toHaveBeenCalledTimes(2);
});

it("does not send a JSON content type for a bodyless plan-generation request", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "run-1" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => planResponse });
  vi.stubGlobal("fetch", fetchMock);
  render(<App defaultView="new" />);
  fireEvent.change(screen.getByLabelText("目标网址"), { target: { value: "http://127.0.0.1:4174" } });
  fireEvent.change(screen.getByLabelText("测试目标"), { target: { value: "Create a project" } });
  fireEvent.click(screen.getByRole("button", { name: "生成测试计划" }));
  await screen.findByRole("heading", { name: "Create a project" });

  const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
  expect(secondInit.body).toBeUndefined();
  expect(secondInit.headers).toBeUndefined();
});

it("renders the draft bug metadata and separates expected from actual", async () => {
  const bugApi = { getBug: vi.fn().mockResolvedValue(bugDetailResponse) };
  renderBug("bug-rename-persistence", bugApi);

  expect(await screen.findByRole("heading", { name: "Project name reverts after page refresh" })).toBeInTheDocument();
  expect(screen.getByText("草稿")).toBeInTheDocument();
  expect(screen.getByText("高")).toBeInTheDocument();
  expect(screen.getByText("真实缺陷")).toBeInTheDocument();
  expect(screen.getByText("94%")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "预期状态" })).getByText("The renamed project remains Project Alpha after refresh.")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "实际状态" })).getByText("The project name returned to Project Draft after refresh.")).toBeInTheDocument();
});

it("preserves reproduction order and renders every evidence card including the screenshot", async () => {
  const bugApi = { getBug: vi.fn().mockResolvedValue(bugDetailResponse) };
  renderBug("bug-rename-persistence", bugApi);
  await screen.findByRole("heading", { name: "Project name reverts after page refresh" });

  const reproduction = screen.getByRole("region", { name: "复现步骤" });
  expect(within(reproduction).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "Sign in to TaskForge",
    "Rename Project Draft to Project Alpha",
    "Refresh the project page",
  ]);
  expect(within(screen.getByRole("region", { name: "证据" })).getAllByRole("article")).toHaveLength(3);
  expect(screen.getByRole("img", { name: "Project name reverts after page refresh 的截图证据" })).toHaveAttribute("src", "/fixtures/rename-reverted.png");
  expect(screen.getByText("Project Draft", { selector: ".evidence-content" })).toBeInTheDocument();
  expect(screen.getByText("PATCH /api/projects/project-1 returned 200 before refresh")).toBeInTheDocument();
});

it("renders only report-referenced evidence in evidenceIds order", async () => {
  const screenshotEvidence = bugDetailResponse.evidence.find((evidence) => evidence.id === "evidence-screenshot")!;
  const visibleEvidence = bugDetailResponse.evidence.find((evidence) => evidence.id === "evidence-visible-text")!;
  const networkEvidence = bugDetailResponse.evidence.find((evidence) => evidence.id === "evidence-network")!;
  const bugApi = { getBug: vi.fn().mockResolvedValue({
    ...bugDetailResponse,
    report: { ...bugDetailResponse.report, evidenceIds: ["evidence-network", "evidence-screenshot"] },
    evidence: [
      screenshotEvidence,
      { ...visibleEvidence, id: "evidence-unbound", content: "Unbound diagnostic" },
      networkEvidence,
      visibleEvidence,
    ],
  }) };
  renderBug("bug-rename-persistence", bugApi);
  await screen.findByRole("heading", { name: "Project name reverts after page refresh" });

  const evidenceRegion = screen.getByRole("region", { name: "证据" });
  const evidenceCards = within(evidenceRegion).getAllByRole("article");
  expect(evidenceCards).toHaveLength(2);
  expect(within(evidenceCards[0]!).getByText("evidence-network")).toBeInTheDocument();
  expect(within(evidenceCards[1]!).getByText("evidence-screenshot")).toBeInTheDocument();
  expect(within(evidenceRegion).getByText("2 项关联证据")).toBeInTheDocument();
  expect(within(evidenceRegion).queryByText("evidence-unbound")).not.toBeInTheDocument();
  expect(within(evidenceRegion).queryByText("evidence-visible-text")).not.toBeInTheDocument();
});

it("never exposes a server artifact path from an unexpected evidence field", async () => {
  const bugApi = { getBug: vi.fn().mockResolvedValue({
    ...bugDetailResponse,
    evidence: bugDetailResponse.evidence.map((evidence, index) => index === 0
      ? { ...evidence, artifactPath: "server-only/runs/run-1/private-screenshot.png" }
      : evidence),
  }) };
  renderBug("bug-rename-persistence", bugApi);
  await screen.findByRole("heading", { name: "Project name reverts after page refresh" });

  expect(screen.queryByText("server-only/runs/run-1/private-screenshot.png")).not.toBeInTheDocument();
});

it("alerts when a referenced screenshot has no API view URL", async () => {
  const bugApi = { getBug: vi.fn().mockResolvedValue({
    ...bugDetailResponse,
    evidence: bugDetailResponse.evidence.map((evidence) => evidence.id === "evidence-screenshot"
      ? { ...evidence, viewUrl: undefined }
      : evidence),
  }) };
  renderBug("bug-rename-persistence", bugApi);

  expect(await screen.findByRole("alert")).toHaveTextContent("截图证据 evidence-screenshot 没有可查看的地址。");
  expect(screen.queryByRole("img", { name: "Project name reverts after page refresh 的截图证据" })).not.toBeInTheDocument();
});

it("alerts when report evidence references an unavailable item", async () => {
  const bugApi = { getBug: vi.fn().mockResolvedValue({
    ...bugDetailResponse,
    evidence: bugDetailResponse.evidence.filter((evidence) => evidence.id !== "evidence-visible-text"),
  }) };
  renderBug("bug-rename-persistence", bugApi);

  expect(await screen.findByRole("alert")).toHaveTextContent("引用的证据 evidence-visible-text 不可用。");
});

it("labels mock bug data and does not expose Phase 5 actions", async () => {
  const bugApi = { getBug: vi.fn().mockResolvedValue(bugDetailResponse) };
  renderBug("bug-rename-persistence", bugApi);
  await screen.findByRole("heading", { name: "Project name reverts after page refresh" });

  expect(screen.getByText("模拟数据")).toBeInTheDocument();
  expect(screen.queryByText(/Approve GitHub Issue/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Create Issue/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Retest|Re-test/i)).not.toBeInTheDocument();
});

it("shows a read error when the Bug Detail API fails", async () => {
  const bugApi = { getBug: vi.fn().mockRejectedValue(new Error("Bug report is unavailable")) };
  renderBug("bug-missing", bugApi);

  expect(await screen.findByRole("alert")).toHaveTextContent("Bug report is unavailable");
  expect(screen.queryByRole("heading", { name: "Project name reverts after page refresh" })).not.toBeInTheDocument();
});

it("opens Bug Detail from the read-only bugId URL query", async () => {
  window.history.pushState({}, "", "/?bugId=bug-rename-persistence");
  const bugApi = { getBug: vi.fn().mockResolvedValue(bugDetailResponse) };
  render(<App bugApi={bugApi} />);

  expect(await screen.findByRole("heading", { name: "Project name reverts after page refresh" })).toBeInTheDocument();
  expect(bugApi.getBug).toHaveBeenCalledWith("bug-rename-persistence");
  expect(screen.queryByRole("heading", { name: "测试范围" })).not.toBeInTheDocument();
});
