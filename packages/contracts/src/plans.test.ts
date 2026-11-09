import { describe, expect, it } from "vitest";
import { validateTestPlan } from "./index";

const validPlan = {
  schemaVersion: "1" as const,
  title: "TaskForge project lifecycle",
  goal: "Log in, create a project, rename it, and log out.",
  assumptions: ["A test account is available."],
  successCriteria: ["The renamed project is visible before logout."],
  steps: [
    {
      id: "login",
      description: "Sign in with the supplied test account.",
      intent: "Establish an authenticated session.",
      expectedState: "The Projects workspace is visible.",
      riskLevel: "LOW" as const,
      dependencies: [],
    },
    {
      id: "create-project",
      description: "Create a project named Sentinel Release.",
      intent: "Exercise project creation.",
      expectedState: "Sentinel Release is listed in the workspace.",
      riskLevel: "MEDIUM" as const,
      dependencies: ["login"],
    },
  ],
};

describe("validateTestPlan", () => {
  it("accepts a dependency-valid plan within its step budget", () => {
    expect(validateTestPlan(validPlan, { maxSteps: 3 })).toEqual({ ok: true, plan: validPlan, requiresHumanReview: false });
  });

  it("rejects a plan that exceeds the run step budget", () => {
    const result = validateTestPlan(validPlan, { maxSteps: 1 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected the plan to be rejected");
    expect(result.errors).toContain("Plan has 2 steps but the run budget allows 1.");
  });

  it("rejects selectors and invented URLs in an otherwise structured plan", () => {
    const result = validateTestPlan({
      ...validPlan,
      steps: [{ ...validPlan.steps[0], description: "Click #delete at https://untrusted.example" }],
    }, { maxSteps: 3 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected the plan to be rejected");
    expect(result.errors).toContain("Plan content must not contain raw selectors or URLs.");
  });

  it("accepts typed deterministic assertions without requiring them on legacy steps", () => {
    const plan = {
      ...validPlan,
      steps: validPlan.steps.map((step, index) => index === 0 ? {
        ...step,
        assertions: [
          { id: "projects-heading", type: "VISIBLE_TEXT_CONTAINS" as const, value: "Projects", required: true },
          { id: "workspace-path", type: "URL_PATH_EQUALS" as const, value: "/workspace", required: true },
        ],
      } : step),
    };

    expect(validateTestPlan(plan, { maxSteps: 3 })).toEqual({ ok: true, plan, requiresHumanReview: false });
  });
});
