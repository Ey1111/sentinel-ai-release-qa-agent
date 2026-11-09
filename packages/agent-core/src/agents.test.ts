import { describe, expect, it } from "vitest";
import { MockLLMProvider } from "@sentinel/llm";
import { PlannerAgent, QaExecutionAgent } from "./index";

const plan = {
  schemaVersion: "1" as const,
  title: "TaskForge login",
  goal: "Log in to TaskForge.",
  assumptions: ["The supplied account is valid."],
  successCriteria: ["The Projects workspace is visible."],
  steps: [{
    id: "login",
    description: "Sign in with the supplied test account.",
    intent: "Establish an authenticated session.",
    expectedState: "The Projects workspace is visible.",
    riskLevel: "LOW" as const,
    dependencies: [],
  }],
};

describe("PlannerAgent repair", () => {
  const input = { targetUrl: "https://app.example.com", testGoal: "Sign in", allowedDomains: ["https://app.example.com"], maxSteps: 5 };
  const plan = (description: string) => ({
    schemaVersion: "1",
    title: "Sign in",
    goal: "Sign in",
    assumptions: [],
    successCriteria: ["Signed in"],
    steps: [{ id: "step-1", description, intent: "Open", expectedState: "Open", riskLevel: "LOW", dependencies: [] }],
  });

  it("gives the model one chance to fix a rejected plan", async () => {
    const result = await new PlannerAgent(new MockLLMProvider([plan("Open https://app.example.com"), plan("Open the target application")])).generate(input);
    expect(result.plan.steps[0]?.description).toBe("Open the target application");
  });

  it("keeps fixture assertions but removes rules written by a real model", async () => {
    const withRule = { ...plan("Open the app"), steps: [{ ...plan("Open the app").steps[0], assertions: [{ id: "a", type: "VISIBLE_TEXT_CONTAINS", value: "Guessed heading", required: true }] }] };
    const real = { generateStructured: async () => ({ output: withRule, metadata: { isMock: false } }) } as never;
    expect((await new PlannerAgent(real).generate(input)).plan.steps[0]).not.toHaveProperty("assertions");
    const mock = await new PlannerAgent(new MockLLMProvider([withRule])).generate(input);
    expect(mock.plan.steps[0]?.assertions).toHaveLength(1);
  });

  it("still rejects a plan that fails validation twice", async () => {
    const bad = plan("Open https://app.example.com");
    await expect(new PlannerAgent(new MockLLMProvider([bad, bad])).generate(input)).rejects.toThrow("Planner output rejected");
  });
});

describe("PlannerAgent", () => {
  it("returns a validated draft plan with explicit model provenance", async () => {
    const agent = new PlannerAgent(new MockLLMProvider([plan]));

    const result = await agent.generate({
      targetUrl: "http://127.0.0.1:4174",
      testGoal: "Log in to TaskForge.",
      allowedDomains: ["127.0.0.1:4174"],
      maxSteps: 4,
    });

    expect(result.plan).toEqual(plan);
    expect(result.status).toBe("DRAFT");
    expect(result.provenance).toMatchObject({ promptId: "planner.v1", isMock: true });
  });
});

describe("QaExecutionAgent", () => {
  it("returns a validated action decision grounded in the current observation", async () => {
    const decision = {
      schemaVersion: "1" as const,
      type: "ACTION" as const,
      stepId: "login",
      action: { type: "CLICK" as const, elementRef: "e1" },
      conciseReason: "Submit the completed login form.",
      confidence: 0.87,
    };
    const agent = new QaExecutionAgent(new MockLLMProvider([decision]));

    const result = await agent.decide({
      plan,
      currentStep: plan.steps[0],
      observation: {
        url: "http://127.0.0.1:4174/",
        title: "TaskForge",
        visibleText: "Log in",
        ariaSnapshot: "button Log in",
        interactiveElements: [{ ref: "e1", role: "button", name: "Log in" }],
      },
      recentDecisions: [],
      remainingBudget: { steps: 4, retriesForStep: 1, llmCalls: 7 },
      allowedOrigins: ["http://127.0.0.1:4174"],
    });

    expect(result.decision).toEqual(decision);
    expect(result.provenance).toMatchObject({ promptId: "qa-executor.v1", isMock: true });
  });
});
