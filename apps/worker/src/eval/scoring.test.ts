import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCases, renderReport, summarize, type EvalResult } from "./scoring";

function result(over: Partial<EvalResult>): EvalResult {
  return { caseId: "c", category: "NORMAL", trial: 1, expected: "PASS", actual: "PASS", safetyViolations: [], failedSteps: [], llmCalls: 2, totalTokens: 100, durationMs: 2000, ...over };
}

describe("parseCases", () => {
  const line = (over: object) => JSON.stringify({ id: "a", category: "NORMAL", target: { taskforge: "none" }, expected: "PASS", testGoal: "Goal", ...over });

  it("reads the checked-in dataset", () => {
    const cases = parseCases(readFileSync(resolve(__dirname, "../../../../evals/cases.jsonl"), "utf8"));
    expect(cases.length).toBeGreaterThanOrEqual(25);
    expect(cases.filter((item) => item.expected === "FAIL").every((item) => item.bugSignal)).toBe(true);
  });

  it("rejects duplicates, unknown categories, and bug cases with no signal", () => {
    expect(() => parseCases(`${line({})}\n${line({})}`)).toThrow(/duplicated/);
    expect(() => parseCases(line({ category: "OTHER" }))).toThrow(/category/);
    expect(() => parseCases(line({ expected: "FAIL" }))).toThrow(/bugSignal/);
  });
});

describe("summarize", () => {
  it("separates catching a bug from catching it for the right reason", () => {
    const summary = summarize([
      result({ expected: "FAIL", actual: "FAIL", category: "INJECTED_BUG", rightCause: true }),
      result({ expected: "FAIL", actual: "FAIL", category: "INJECTED_BUG", rightCause: false }),
      result({ expected: "FAIL", actual: "PASS", category: "INJECTED_BUG" }),
      result({ expected: "FAIL", actual: "UNCERTAIN", category: "INJECTED_BUG" }),
    ]);
    expect(summary.bugRecall).toBe(0.5);
    expect(summary.bugRecallRightCause).toBe(0.25);
    expect(summary.taskSuccessRate).toBe(0.5);
  });

  it("counts a FAIL on healthy behaviour as a false positive, but not UNCERTAIN", () => {
    const summary = summarize([result({ actual: "FAIL" }), result({ actual: "UNCERTAIN" }), result({}), result({ actual: "NO_VERDICT" })]);
    expect(summary.falsePositiveRate).toBe(0.25);
    expect(summary.uncertainRate).toBe(0.25);
    expect(summary.noVerdictRate).toBe(0.25);
    expect(summary.confusion.PASS).toEqual({ PASS: 1, FAIL: 1, UNCERTAIN: 1, NO_VERDICT: 1 });
  });

  it("reports n/a rather than a flattering number when nothing was measured", () => {
    expect(summarize([result({})]).bugRecall).toBeNull();
    expect(renderReport({ model: "m", startedAt: "t", results: [result({})] })).toContain("| Bug recall | n/a |");
  });

  it("surfaces safety violations and keeps table cells on one line", () => {
    const report = renderReport({ model: "m", startedAt: "t", results: [result({ safetyViolations: ["left allowed origin"], reason: "a|b\nc" })] });
    expect(report).toContain("| Safety violations | 1 |");
    expect(report).toContain("a\\|b c");
  });
});
