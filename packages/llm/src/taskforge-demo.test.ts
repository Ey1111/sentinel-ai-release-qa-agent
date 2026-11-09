import { describe, expect, it } from "vitest";
import { validateTestPlan, AgentDecisionSchema, BugReportSchema, TestPlanSchema } from "@sentinel/contracts";
import { TASKFORGE_DEMO_PLAN, TaskForgeDemoProvider } from "./index";

const elements = [
  { ref: "e1", role: "textbox", name: "Email" },
  { ref: "e2", role: "textbox", name: "Password" },
  { ref: "e3", role: "button", name: "Log in" },
];

function decide(provider: TaskForgeDemoProvider, stepId: string, actionsTaken: number) {
  const prompt = JSON.stringify({
    approvedPlanStep: { id: stepId, expectedState: "Expected" },
    recentDecisions: Array.from({ length: actionsTaken }, () => ({ type: "ACTION", stepId })),
    UNTRUSTED_PAGE_CONTENT: { interactiveElements: elements },
  });
  return provider.generateStructured({ promptId: "qa-executor.v1", schemaVersion: "1", schema: AgentDecisionSchema, system: "s", prompt });
}

describe("TaskForgeDemoProvider", () => {
  const provider = new TaskForgeDemoProvider("http://localhost:4174/?breakMode=login-failure");

  it("offers a plan that passes the real validator and is marked as mock", async () => {
    expect(validateTestPlan(TASKFORGE_DEMO_PLAN, { maxSteps: 12 }).ok).toBe(true);
    const result = await provider.generateStructured({ promptId: "planner.v1", schemaVersion: "1", schema: TestPlanSchema, system: "s", prompt: "{}" });
    expect(result.metadata).toMatchObject({ isMock: true, model: "taskforge-demo-script" });
  });

  it("opens exactly the target URL, then finishes step one", async () => {
    expect((await decide(provider, "step-1", 0)).output.action).toEqual({ type: "NAVIGATE", url: "http://localhost:4174/?breakMode=login-failure" });
    expect((await decide(provider, "step-1", 1)).output.type).toBe("FINISH");
  });

  it("fills both fields, submits, then finishes", async () => {
    expect((await decide(provider, "step-2", 0)).output.action).toMatchObject({ type: "FILL", elementRef: "e1" });
    expect((await decide(provider, "step-2", 1)).output.action).toMatchObject({ type: "FILL", elementRef: "e2" });
    expect((await decide(provider, "step-2", 2)).output.action).toEqual({ type: "CLICK", elementRef: "e3" });
    expect((await decide(provider, "step-2", 3)).output.type).toBe("FINISH");
  });

  it("builds a bug report only from the failed assertion it was given", async () => {
    const prompt = JSON.stringify({ failedAssertion: { expected: "E", actual: "A", confidence: 1, evidenceIds: ["e9"] }, reproductionSteps: ["Click it"] });
    const { output } = await provider.generateStructured({ promptId: "bug-reporter.v1", schemaVersion: "1", schema: BugReportSchema, system: "s", prompt });
    expect(output).toMatchObject({ expected: "E", actual: "A", evidenceIds: ["e9"], stepsToReproduce: ["Click it"] });
  });

  it("refuses prompts it has no script for", async () => {
    await expect(provider.generateStructured({ promptId: "critic.v1", schemaVersion: "1", schema: BugReportSchema, system: "s", prompt: "{}" })).rejects.toThrow(/no response/);
  });
});
