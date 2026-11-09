import { promptHash, type LLMProvider, type LLMResult, type StructuredLLMRequest } from "./index";

/**
 * Deterministic stand-in for a model, used only with SENTINEL_LLM_PROVIDER=mock.
 * It knows the TaskForge demo target and nothing else; results are marked isMock so the UI labels them.
 * The password below is the public fixture that TaskForge prints on its own sign-in page.
 */
const DEMO_EMAIL = "qa@taskforge.local";
const DEMO_PASSWORD = "sentinel-demo";

type QaPrompt = {
  approvedPlanStep: { id: string; expectedState: string };
  recentDecisions: Array<{ type: string; stepId: string }>;
  UNTRUSTED_PAGE_CONTENT: { interactiveElements: Array<{ ref: string; role: string; name: string }> };
};

type BugPrompt = {
  failedAssertion: { expected: string; actual: string; confidence: number; evidenceIds: string[] };
  reproductionSteps: string[];
};

export const TASKFORGE_DEMO_PLAN = {
  schemaVersion: "1",
  title: "TaskForge sign-in acceptance",
  goal: "A user can sign in and reach the Projects workspace",
  assumptions: ["The target is the local TaskForge demo application"],
  successCriteria: ["The Projects workspace is visible after signing in"],
  steps: [
    {
      id: "step-1",
      description: "Open TaskForge",
      intent: "Reach the sign-in page",
      expectedState: "The TaskForge sign-in page is visible",
      riskLevel: "LOW",
      dependencies: [],
      assertions: [{ id: "signin-visible", type: "VISIBLE_TEXT_CONTAINS", value: "Welcome back", required: true }],
    },
    {
      id: "step-2",
      description: "Sign in with the demo account",
      intent: "Exercise the sign-in journey",
      expectedState: "The Projects workspace is visible",
      riskLevel: "MEDIUM",
      dependencies: ["step-1"],
      assertions: [{ id: "workspace-visible", type: "VISIBLE_TEXT_CONTAINS", value: "Plan, rename, and retire release workspaces.", required: true }],
    },
  ],
};

export class TaskForgeDemoProvider implements LLMProvider {
  constructor(private readonly targetUrl?: string) {}

  async generateStructured<T>(request: StructuredLLMRequest<T>): Promise<LLMResult<T>> {
    const parsed = request.schema.safeParse(this.respond(request.promptId, request.prompt));
    if (!parsed.success) throw new Error(`Demo output failed schema validation: ${parsed.error.message}`);
    return {
      output: parsed.data,
      metadata: {
        provider: "mock",
        model: "taskforge-demo-script",
        promptId: request.promptId,
        promptHash: promptHash(request),
        schemaVersion: request.schemaVersion,
        latencyMs: 0,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        estimatedCostMicros: null,
        isMock: true,
      },
    };
  }

  private respond(promptId: string, prompt: string): unknown {
    if (promptId === "planner.v1") return structuredClone(TASKFORGE_DEMO_PLAN);
    if (promptId === "qa-executor.v1") return this.decide(JSON.parse(prompt) as QaPrompt);
    if (promptId === "bug-reporter.v1") return reportBug(JSON.parse(prompt) as BugPrompt);
    throw new Error(`The TaskForge demo script has no response for ${promptId}`);
  }

  private decide(input: QaPrompt): unknown {
    const stepId = input.approvedPlanStep.id;
    const taken = input.recentDecisions.filter((decision) => decision.stepId === stepId && decision.type === "ACTION").length;
    const elements = input.UNTRUSTED_PAGE_CONTENT.interactiveElements;
    const ref = (name: string) => elements.find((element) => element.name.toLowerCase().includes(name))?.ref;
    const finish = { schemaVersion: "1", type: "FINISH", stepId, expectedState: input.approvedPlanStep.expectedState, conciseReason: "Demo script finished this step", confidence: 1 };
    const act = (action: unknown, conciseReason: string) => ({ schemaVersion: "1", type: "ACTION", stepId, action, conciseReason, confidence: 1 });

    if (stepId === "step-1") {
      if (!this.targetUrl) throw new Error("The TaskForge demo script needs a target URL");
      return taken === 0 ? act({ type: "NAVIGATE", url: this.targetUrl }, "Open the approved target") : finish;
    }

    const script: Array<[string, (elementRef: string) => unknown, string]> = [
      ["email", (elementRef) => ({ type: "FILL", elementRef, value: DEMO_EMAIL }), "Enter the demo email"],
      ["password", (elementRef) => ({ type: "FILL", elementRef, value: DEMO_PASSWORD }), "Enter the demo password"],
      ["log in", (elementRef) => ({ type: "CLICK", elementRef }), "Submit the sign-in form"],
    ];
    const next = script[taken];
    if (!next) return finish;
    const elementRef = ref(next[0]);
    if (!elementRef) {
      return { schemaVersion: "1", type: "FAIL", stepId, conciseReason: `Demo script could not find ${next[0]}`, confidence: 1 };
    }
    return act(next[1](elementRef), next[2]);
  }
}

function reportBug(input: BugPrompt): unknown {
  const { expected, actual, confidence, evidenceIds } = input.failedAssertion;
  return {
    schemaVersion: "1",
    title: `Expected state not reached: ${expected}`,
    summary: "The approved step finished, but the page did not reach its expected state.",
    category: "FUNCTIONAL",
    severity: "HIGH",
    classification: "REAL_BUG",
    stepsToReproduce: input.reproductionSteps,
    expected,
    actual,
    evidenceIds,
    confidence,
  };
}
