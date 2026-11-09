import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RunStatus, type RunReadApi, type RunStatusResponse } from "./RunStatus";

const base: RunStatusResponse = { id: "run-1", targetUrl: "http://example.test", status: "QUEUED", result: "NOT_EVALUATED", isMock: false, steps: [], bugs: [] };

function apiReturning(...responses: RunStatusResponse[]): RunReadApi {
  const getRunStatus = vi.fn(async () => responses.length > 1 ? responses.shift()! : responses[0]!);
  return { startRun: vi.fn(), getRunStatus };
}

describe("RunStatus", () => {
  it("does not present a queued run as finished, then shows the recorded verdict and bug link", async () => {
    const api = apiReturning(base, {
      ...base,
      status: "COMPLETED",
      result: "FAIL",
      isMock: true,
      steps: [{ id: "step-1", sequence: 1, description: "Sign in", verdict: "FAIL", expected: "Projects visible", actual: "Error shown", reason: "Assertion failed" }],
      bugs: [{ id: "bug-1", title: "Sign-in broken", severity: "HIGH", classification: "REAL_BUG" }],
    });
    render(<RunStatus runId="run-1" api={api} pollMs={200} />);

    expect(await screen.findByText(/还没有执行进程领取任务/)).toBeInTheDocument();
    expect(screen.queryByText(/结论：/)).not.toBeInTheDocument();

    expect(await screen.findByText("结论：未通过")).toBeInTheDocument();
    expect(screen.getByText("模拟数据")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign-in broken" })).toHaveAttribute("href", "?bugId=bug-1");
  });

  it("shows why a run stopped and stops polling", async () => {
    const api = apiReturning({ ...base, status: "FAILED", failureReason: "WORKER_LOST" });
    render(<RunStatus runId="run-1" api={api} pollMs={1} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("执行进程中断");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await waitFor(() => expect(api.getRunStatus).toHaveBeenCalledTimes(1));
  });
});
