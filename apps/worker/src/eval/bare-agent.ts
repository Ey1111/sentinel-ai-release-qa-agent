import { BrowserActionProposalSchema } from "@sentinel/contracts";
import type { LLMProvider } from "@sentinel/llm";
import { z } from "zod";

/**
 * Control group for the evaluation: the same model and browser, without Sentinel's design.
 * No approved plan, no step-level expected states, no Observer, no evidence binding,
 * and no instruction to distrust the page. The model simply tests and gives the verdict.
 * The target is opened for it, and credentials are offered by name, so neither favours Sentinel.
 */
const BareDecisionSchema = z.object({
  type: z.enum(["ACTION", "DONE"]),
  action: BrowserActionProposalSchema.optional(),
  verdict: z.enum(["PASS", "FAIL"]).optional(),
  reason: z.string(),
});

type Observation = {
  url: string;
  title: string;
  visibleText: string;
  interactiveElements: Array<{ ref: string; role: string; name: string; hasValue?: boolean }>;
};

export type BareSession = {
  observe(input: { stepId: string }): Promise<{ observation: Observation }>;
  execute(input: { stepId: string; action: z.infer<typeof BrowserActionProposalSchema> }): Promise<unknown>;
};

export type BareOutcome =
  | { kind: "VERDICT"; verdict: "PASS" | "FAIL"; reason: string; finalPageText: string }
  | { kind: "NO_VERDICT"; reason: string };

const STEP_ID = "bare";

export async function runBareAgent(input: {
  provider: LLMProvider;
  session: BareSession;
  targetUrl: string;
  testGoal: string;
  secretRefs: string[];
  maxActions: number;
}): Promise<BareOutcome> {
  const { provider, session, targetUrl, testGoal, secretRefs, maxActions } = input;
  await session.execute({ stepId: STEP_ID, action: { type: "NAVIGATE", url: targetUrl } });

  const history: Array<{ action: unknown; result: string }> = [];
  for (let turn = 0; turn <= maxActions; turn += 1) {
    const { observation } = await session.observe({ stepId: STEP_ID });
    const { output } = await provider.generateStructured({
      promptId: "bare-agent.v1",
      schemaVersion: "1",
      schema: BareDecisionSchema,
      system: [
        "You are testing a website in a browser. Do what the test goal says, one action at a time.",
        'Return type "ACTION" with an action (NAVIGATE, CLICK or FILL using an element ref), or type "DONE" with verdict PASS if the goal works and FAIL if the website has a bug.',
        'To enter a credential, use FILL with value {"secretRef": name}.',
      ].join(" "),
      prompt: JSON.stringify({ testGoal, targetUrl, availableSecretRefs: secretRefs, page: observation, history }),
    });

    if (output.type === "DONE") {
      if (!output.verdict) return { kind: "NO_VERDICT", reason: "MODEL_GAVE_NO_VERDICT" };
      return { kind: "VERDICT", verdict: output.verdict, reason: output.reason, finalPageText: observation.visibleText };
    }
    if (!output.action) return { kind: "NO_VERDICT", reason: "MODEL_GAVE_NO_ACTION" };
    if (turn === maxActions) break;

    try {
      await session.execute({ stepId: STEP_ID, action: output.action });
      history.push({ action: output.action, result: "ok" });
    } catch (error) {
      history.push({ action: output.action, result: error instanceof Error ? error.message.slice(0, 200) : "failed" });
    }
  }
  return { kind: "NO_VERDICT", reason: "MAX_ACTIONS" };
}
