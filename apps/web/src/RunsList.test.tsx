import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunsList, type RunListItem } from "./RunsList";

const run = (over: Partial<RunListItem>): RunListItem => ({ id: "run-1", targetUrl: "http://example.test", testGoal: "登录检查", status: "COMPLETED", result: "PASS", createdAt: "2026-11-09T08:00:00.000Z", ...over });

afterEach(cleanup);

describe("RunsList", () => {
  it("summarises runs and links each one to its detail", async () => {
    const api = { listRuns: vi.fn(async () => ({ runs: [run({}), run({ id: "run-2", testGoal: "创建项目", result: "FAIL" }), run({ id: "run-3", testGoal: "删除项目", status: "RUNNING", result: "NOT_EVALUATED" })] })) };
    render(<RunsList api={api} pollMs={60_000} />);

    expect(await screen.findByRole("link", { name: "创建项目" })).toHaveAttribute("href", "?runId=run-2");
    const stat = (label: string) => within(screen.getByText(label).parentElement!).getByRole("strong", { hidden: true });
    expect(stat("全部运行")).toHaveTextContent("3");
    expect(stat("进行中")).toHaveTextContent("1");
  });

  it("invites the first run when there are none", async () => {
    render(<RunsList api={{ listRuns: async () => ({ runs: [] }) }} pollMs={60_000} />);
    expect(await screen.findByText("还没有运行记录")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "新建测试" })).toHaveAttribute("href", "?view=new");
  });

  it("shows a read error instead of an empty list", async () => {
    render(<RunsList api={{ listRuns: async () => { throw new Error("数据库暂时不可用"); } }} pollMs={60_000} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("数据库暂时不可用");
    expect(screen.queryByText("还没有运行记录")).not.toBeInTheDocument();
  });
});
