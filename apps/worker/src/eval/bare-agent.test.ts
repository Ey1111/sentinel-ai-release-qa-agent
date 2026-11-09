import { describe, expect, it, vi } from "vitest";
import { MockLLMProvider } from "@sentinel/llm";
import { runBareAgent, type BareSession } from "./bare-agent";

const page = { url: "http://t/", title: "T", visibleText: "Waiting", interactiveElements: [{ ref: "e1", role: "button", name: "Go" }] };

function session(execute: BareSession["execute"] = vi.fn(async () => ({}))): BareSession {
  return { observe: vi.fn(async () => ({ observation: page })), execute };
}

const base = { targetUrl: "http://t/", testGoal: "Click Go", secretRefs: [], maxActions: 2 };
const click = { type: "ACTION", action: { type: "CLICK", elementRef: "e1" }, reason: "next" };

describe("runBareAgent", () => {
  it("opens the target itself, acts, and returns the model's verdict", async () => {
    const browser = session();
    const result = await runBareAgent({ ...base, session: browser, provider: new MockLLMProvider([click, { type: "DONE", verdict: "PASS", reason: "worked" }]) });
    expect(result).toEqual({ kind: "VERDICT", verdict: "PASS", reason: "worked", finalPageText: "Waiting" });
    expect(browser.execute).toHaveBeenNthCalledWith(1, { stepId: "bare", action: { type: "NAVIGATE", url: "http://t/" } });
    expect(browser.execute).toHaveBeenCalledTimes(2);
  });

  it("stops at the action budget instead of looping forever", async () => {
    const result = await runBareAgent({ ...base, session: session(), provider: new MockLLMProvider([click, click, click]) });
    expect(result).toEqual({ kind: "NO_VERDICT", reason: "MAX_ACTIONS" });
  });

  it("lets the model see a failed action and carry on", async () => {
    const execute = vi.fn(async (input: { action: { type: string } }) => {
      if (input.action.type === "CLICK") throw new Error("element gone");
      return {};
    });
    const result = await runBareAgent({ ...base, session: session(execute as BareSession["execute"]), provider: new MockLLMProvider([click, { type: "DONE", verdict: "FAIL", reason: "broken" }]) });
    expect(result).toMatchObject({ kind: "VERDICT", verdict: "FAIL" });
  });

  it("treats a DONE without a verdict as no verdict", async () => {
    const result = await runBareAgent({ ...base, session: session(), provider: new MockLLMProvider([{ type: "DONE", reason: "unsure" }]) });
    expect(result).toEqual({ kind: "NO_VERDICT", reason: "MODEL_GAVE_NO_VERDICT" });
  });
});
