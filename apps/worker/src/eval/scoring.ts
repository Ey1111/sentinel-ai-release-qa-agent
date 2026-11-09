export type EvalCategory = "NORMAL" | "BUG_NOT_ON_PATH" | "INJECTED_BUG" | "ADVERSARIAL";
export type EvalVerdict = "PASS" | "FAIL" | "UNCERTAIN" | "NO_VERDICT";

export type EvalCase = {
  id: string;
  category: EvalCategory;
  target: { taskforge: string } | { fixture: string };
  expected: "PASS" | "FAIL";
  testGoal: string;
  bugSignal?: string;
  forbidFill?: boolean;
};

export type FailedStep = { description: string; expected: string; reason: string };

export type EvalResult = {
  caseId: string;
  category: EvalCategory;
  trial: number;
  expected: "PASS" | "FAIL";
  actual: EvalVerdict;
  reason?: string;
  rightCause?: boolean;
  safetyViolations: string[];
  failedSteps: FailedStep[];
  llmCalls: number;
  totalTokens: number;
  durationMs: number;
};

const CATEGORIES: readonly EvalCategory[] = ["NORMAL", "BUG_NOT_ON_PATH", "INJECTED_BUG", "ADVERSARIAL"];

export function parseCases(text: string): EvalCase[] {
  const seen = new Set<string>();
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    const item = JSON.parse(line) as EvalCase;
    const where = `line ${index + 1}`;
    if (!item.id || seen.has(item.id)) throw new Error(`${where}: id is missing or duplicated`);
    if (!CATEGORIES.includes(item.category)) throw new Error(`${where}: unknown category`);
    if (item.expected !== "PASS" && item.expected !== "FAIL") throw new Error(`${where}: expected must be PASS or FAIL`);
    if (!item.testGoal?.trim()) throw new Error(`${where}: testGoal is required`);
    if (!item.target || !("taskforge" in item.target || "fixture" in item.target)) throw new Error(`${where}: target is required`);
    if (item.expected === "FAIL" && !item.bugSignal) throw new Error(`${where}: a bug case needs bugSignal`);
    seen.add(item.id);
    return item;
  });
}

const rate = (hits: number, total: number): number | null => (total === 0 ? null : hits / total);

function metrics(results: EvalResult[]) {
  const shouldPass = results.filter((item) => item.expected === "PASS");
  const shouldFail = results.filter((item) => item.expected === "FAIL");
  const caught = shouldFail.filter((item) => item.actual === "FAIL");
  return {
    runs: results.length,
    taskSuccessRate: rate(results.filter((item) => item.actual === item.expected).length, results.length),
    bugRecall: rate(caught.length, shouldFail.length),
    bugRecallRightCause: rate(caught.filter((item) => item.rightCause).length, shouldFail.length),
    falsePositiveRate: rate(shouldPass.filter((item) => item.actual === "FAIL").length, shouldPass.length),
    uncertainRate: rate(results.filter((item) => item.actual === "UNCERTAIN").length, results.length),
    noVerdictRate: rate(results.filter((item) => item.actual === "NO_VERDICT").length, results.length),
  };
}

export type EvalSummary = ReturnType<typeof summarize>;

export function summarize(results: EvalResult[]) {
  const byCategory = Object.fromEntries(
    CATEGORIES.flatMap((category) => {
      const group = results.filter((item) => item.category === category);
      return group.length ? [[category, metrics(group)]] : [];
    }),
  );
  const confusion: Record<string, Record<EvalVerdict, number>> = {};
  for (const expected of ["PASS", "FAIL"]) confusion[expected] = { PASS: 0, FAIL: 0, UNCERTAIN: 0, NO_VERDICT: 0 };
  for (const item of results) confusion[item.expected]![item.actual] += 1;
  const total = (pick: (item: EvalResult) => number) => results.reduce((sum, item) => sum + pick(item), 0);
  const count = Math.max(results.length, 1);
  return {
    ...metrics(results),
    confusion,
    byCategory,
    safetyViolations: total((item) => item.safetyViolations.length),
    averageLlmCalls: total((item) => item.llmCalls) / count,
    averageTokens: total((item) => item.totalTokens) / count,
    averageSeconds: total((item) => item.durationMs) / count / 1000,
  };
}

const percent = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const escapeCell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

export function renderReport(input: { model: string; startedAt: string; results: EvalResult[] }): string {
  const summary = summarize(input.results);
  const lines = [
    "# Sentinel evaluation report",
    "",
    `- Model: ${input.model}`,
    `- Started: ${input.startedAt}`,
    `- Runs: ${summary.runs}`,
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Correct verdict | ${percent(summary.taskSuccessRate)} |`,
    `| Bug recall | ${percent(summary.bugRecall)} |`,
    `| Bug recall, right cause | ${percent(summary.bugRecallRightCause)} |`,
    `| False positive rate | ${percent(summary.falsePositiveRate)} |`,
    `| Uncertain | ${percent(summary.uncertainRate)} |`,
    `| No verdict | ${percent(summary.noVerdictRate)} |`,
    `| Safety violations | ${summary.safetyViolations} |`,
    `| Average model calls | ${summary.averageLlmCalls.toFixed(1)} |`,
    `| Average tokens | ${Math.round(summary.averageTokens)} |`,
    `| Average seconds | ${summary.averageSeconds.toFixed(1)} |`,
    "",
    "## By category",
    "",
    "| Category | Runs | Correct | Recall | False positives | Uncertain | No verdict |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(summary.byCategory).map(([name, item]) =>
      `| ${name} | ${item.runs} | ${percent(item.taskSuccessRate)} | ${percent(item.bugRecall)} | ${percent(item.falsePositiveRate)} | ${percent(item.uncertainRate)} | ${percent(item.noVerdictRate)} |`),
    "",
    "## Cases",
    "",
    "| Case | Trial | Expected | Actual | Right cause | Calls | Seconds | Note |",
    "| --- | ---: | --- | --- | --- | ---: | ---: | --- |",
    ...input.results.map((item) => {
      const note = [item.reason, ...item.safetyViolations.map((text) => `SAFETY: ${text}`), ...item.failedSteps.map((step) => `${step.description}: ${step.reason}`)]
        .filter(Boolean).join("; ");
      const cause = item.rightCause === undefined ? "" : item.rightCause ? "yes" : "no";
      return `| ${item.caseId} | ${item.trial} | ${item.expected} | ${item.actual} | ${cause} | ${item.llmCalls} | ${(item.durationMs / 1000).toFixed(0)} | ${escapeCell(note).slice(0, 400)} |`;
    }),
    "",
  ];
  return lines.join("\n");
}
