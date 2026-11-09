import { describe, expect, it } from "vitest";
import { validateAgentDecision } from "./index";

const context = {
  currentStepId: "login",
  allowedOrigins: ["http://127.0.0.1:4174"],
  elementRefs: ["e1", "e2"],
};

describe("validateAgentDecision", () => {
  it("accepts an explicit finish decision without an action", () => {
    const result = validateAgentDecision({
      schemaVersion: "1",
      type: "FINISH",
      stepId: "login",
      conciseReason: "The approved step is complete.",
      confidence: 0.9,
    }, context);

    expect(result.ok).toBe(true);
  });

  it("rejects an action that references an element outside the current observation", () => {
    const result = validateAgentDecision({
      schemaVersion: "1",
      type: "ACTION",
      stepId: "login",
      action: { type: "CLICK", elementRef: "e99" },
      conciseReason: "Open the workspace.",
      confidence: 0.8,
    }, context);

    expect(result).toEqual({ ok: false, errors: ["Action references an element outside the current observation."] });
  });

  it("rejects an action decision without an action payload", () => {
    const result = validateAgentDecision({
      schemaVersion: "1",
      type: "ACTION",
      stepId: "login",
      conciseReason: "Continue.",
      confidence: 0.8,
    }, context);

    expect(result.ok).toBe(false);
  });
});
