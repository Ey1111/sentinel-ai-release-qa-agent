import { describe, expect, it } from "vitest";
import { createQaLoop } from "./index";

describe("createQaLoop", () => {
  it("pauses instead of accepting another decision after the step budget is exhausted", () => {
    const loop = createQaLoop({ maxSteps: 1, maxRetriesPerStep: 1 });
    loop.recordExecutedAction();

    expect(loop.nextAllowance()).toEqual({ allowed: false, reason: "MAX_STEPS_EXCEEDED" });
  });

  it("rejects a retry request after the per-step retry budget is exhausted", () => {
    const loop = createQaLoop({ maxSteps: 3, maxRetriesPerStep: 1 });
    loop.recordRetry("create-project");

    expect(loop.canRetry("create-project")).toEqual({ allowed: false, reason: "RETRY_BUDGET_EXCEEDED" });
  });
});
