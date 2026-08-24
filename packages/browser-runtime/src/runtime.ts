import { chromium, errors, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { ArtifactStore } from "./artifact-store";
import { DomainPolicy, PolicyViolationError } from "./policy";
import { containsExactSecret, redactSecrets } from "./redaction";
import { JsonRunStore } from "./run-store";
import type { BrowserAction, BrowserEvent, BrowserTarget, FixedTestSpec, Observation, RunResult, StepError } from "./types";

type RuntimeOptions = { artifactRoot: string; headless?: boolean; now?: () => Date };

class EvidencePolicyError extends Error {}

export class BrowserRuntime {
  private readonly options: RuntimeOptions;

  constructor(options: RuntimeOptions) {
    this.options = options;
  }

  async run(spec: FixedTestSpec): Promise<RunResult> {
    validateSpec(spec);
    const now = this.options.now ?? (() => new Date());
    const secretValues = spec.steps.flatMap((step) => step.action.type === "fill" && step.action.secret ? [step.action.value] : []);
    const redact = (value: string) => redactSecrets(value, secretValues);
    const policy = new DomainPolicy({ allowedOrigins: spec.allowedOrigins, ...(spec.allowLocalhost === undefined ? {} : { allowLocalhost: spec.allowLocalhost }) });
    const artifacts = new ArtifactStore({ rootDir: this.options.artifactRoot, runId: spec.runId, now });
    const state = new JsonRunStore(this.options.artifactRoot, spec.runId);
    await artifacts.initialize();
    const result: RunResult = {
      runId: spec.runId,
      name: spec.name,
      status: "RUNNING",
      startedAt: now().toISOString(),
      steps: spec.steps.map((step, index) => ({ id: step.id, index, action: persistedAction(step.action), status: "SKIPPED", artifactKeys: [] })),
    };
    await state.persist(result);

    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    try {
      browser = await chromium.launch({ headless: this.options.headless ?? true });
      context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block" });
      const page = await context.newPage();
      page.setDefaultTimeout(spec.timeoutMs);
      page.setDefaultNavigationTimeout(spec.timeoutMs);
      const events: BrowserEvent[] = [];
      let activeStepId = "bootstrap";
      let activePolicyViolation: PolicyViolationError | undefined;
      let pageEpoch = 0;
      let lastUrl = page.url();
      attachTelemetry(page, events, () => activeStepId, now, redact);
      page.on("request", (request) => {
        try { policy.assertAllowed(request.url()); }
        catch (error) { if (error instanceof PolicyViolationError) activePolicyViolation = error; }
      });
      await context.route("**/*", async (route) => {
        try {
          policy.assertAllowed(route.request().url());
          await route.continue();
        } catch (error) {
          if (error instanceof PolicyViolationError) activePolicyViolation = error;
          await route.abort("blockedbyclient");
          if (error instanceof PolicyViolationError) return;
          throw error;
        }
      });

      let failed = false;
      for (const step of result.steps) {
        if (failed) {
          await state.persist(result, step);
          continue;
        }
        activeStepId = step.id;
        activePolicyViolation = undefined;
        step.status = "RUNNING";
        step.startedAt = now().toISOString();
        await state.persist(result, step);
        try {
          const source = spec.steps[step.index];
          if (!source) throw new Error(`Missing source step at index ${step.index}`);
          const explicitArtifact = await executeAction(page, source.action, policy, artifacts, step.id, spec.timeoutMs, secretValues);
          if (activePolicyViolation) throw activePolicyViolation;
          assertCurrentPageAllowed(page, policy);
          if (explicitArtifact) step.artifactKeys.push(explicitArtifact);
          if (page.url() !== lastUrl) { pageEpoch += 1; lastUrl = page.url(); }
          const captured = await captureObservation(page, pageEpoch, now, secretValues, redact);
          step.observation = captured.observation;
          const observationEntry = await artifacts.writeJson(`observations/${safeName(step.id)}.json`, step.observation, { stepId: step.id, redacted: true });
          step.artifactKeys.push(observationEntry.key);
          const stepEvents = events.filter((event) => event.stepId === step.id);
          const consoleEntry = await artifacts.writeJson(`console/${safeName(step.id)}.json`, stepEvents.filter((event) => event.type === "CONSOLE" || event.type === "PAGEERROR"), { stepId: step.id, redacted: true });
          const networkEntry = await artifacts.writeJson(`network/${safeName(step.id)}.json`, stepEvents.filter((event) => event.type === "REQUEST" || event.type === "RESPONSE" || event.type === "REQUESTFAILED"), { stepId: step.id, redacted: true });
          step.artifactKeys.push(consoleEntry.key, networkEntry.key);
          if (captured.secretVisible || (source.action.type === "fill" && source.action.secret)) {
            const suppressed = await artifacts.writeJson(`evidence/${String(step.index).padStart(3, "0")}-${safeName(step.id)}-screenshot-suppressed.json`, { reason: "SECRET_VISIBLE", screenshotCaptured: false }, { stepId: step.id, redacted: true });
            step.artifactKeys.push(suppressed.key);
          } else {
            const screenshot = await page.screenshot({ fullPage: true, type: "png" });
            const screenshotEntry = await artifacts.write(`screenshots/${String(step.index).padStart(3, "0")}-${safeName(step.id)}.png`, screenshot, "image/png", { stepId: step.id, redacted: false });
            step.artifactKeys.push(screenshotEntry.key);
          }
          step.status = "PASSED";
        } catch (error) {
          step.status = "FAILED";
          step.error = normalizeError(activePolicyViolation ?? error, redact);
          failed = true;
          try {
            if (await pageContainsSecret(page, secretValues)) {
              const entry = await artifacts.writeJson(`evidence/${String(step.index).padStart(3, "0")}-${safeName(step.id)}-failure-screenshot-suppressed.json`, { reason: "SECRET_VISIBLE", screenshotCaptured: false }, { stepId: step.id, redacted: true });
              step.artifactKeys.push(entry.key);
            } else {
              const failureScreenshot = await page.screenshot({ fullPage: true, type: "png" });
              const entry = await artifacts.write(`screenshots/${String(step.index).padStart(3, "0")}-${safeName(step.id)}-failure.png`, failureScreenshot, "image/png", { stepId: step.id, redacted: false });
              step.artifactKeys.push(entry.key);
            }
          } catch (captureError) {
            step.error = { code: "EVIDENCE_FAILED", message: `${step.error.message}; screenshot capture failed: ${errorMessage(captureError, redact)}` };
          }
        } finally {
          step.finishedAt = now().toISOString();
          await state.persist(result, step);
        }
      }
      result.status = failed ? "FAILED" : "PASSED";
    } catch (error) {
      result.status = "FAILED";
      const pending = result.steps.find((step) => step.status === "SKIPPED");
      if (pending) {
        pending.status = "FAILED";
        pending.error = normalizeError(error, redact);
        pending.finishedAt = now().toISOString();
      }
    } finally {
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
      result.finishedAt = now().toISOString();
      await state.persist(result);
    }
    return result;
  }
}

async function executeAction(page: Page, action: BrowserAction, policy: DomainPolicy, artifacts: ArtifactStore, stepId: string, timeoutMs: number, secretValues: string[]): Promise<string | undefined> {
  switch (action.type) {
    case "navigate":
      policy.assertAllowed(action.url);
      await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      return undefined;
    case "click":
      await locatorFor(page, action.target).click({ timeout: timeoutMs });
      return undefined;
    case "fill":
      await locatorFor(page, action.target).fill(action.value, { timeout: timeoutMs });
      return undefined;
    case "snapshot":
      return undefined;
    case "screenshot": {
      if (await pageContainsSecret(page, secretValues)) throw new EvidencePolicyError("Screenshot suppressed because a configured secret is visible");
      const buffer = await page.screenshot({ fullPage: true, type: "png" });
      const entry = await artifacts.write(`screenshots/${safeName(action.name)}.png`, buffer, "image/png", { stepId, redacted: false });
      return entry.key;
    }
  }
}

function locatorFor(page: Page, target: BrowserTarget): Locator {
  if (target.by === "label") return page.getByLabel(target.value, { exact: true });
  if (target.by === "text") return page.getByText(target.value, { exact: true });
  return page.getByRole(target.role, { name: target.name, exact: true });
}

function assertCurrentPageAllowed(page: Page, policy: DomainPolicy): void {
  const currentUrl = page.url();
  if (currentUrl === "about:blank") return;
  policy.assertAllowed(currentUrl);
}

async function captureObservation(page: Page, pageEpoch: number, now: () => Date, secretValues: string[], redact: (value: string) => string): Promise<{ observation: Observation; secretVisible: boolean }> {
  const body = page.locator("body");
  const rawTitle = await page.title();
  const rawVisibleText = (await body.innerText()).slice(0, 50_000);
  const rawAriaSnapshot = (await body.ariaSnapshot()).slice(0, 50_000);
  return { observation: {
    pageEpoch,
    url: page.url(),
    title: redact(rawTitle),
    visibleText: redact(rawVisibleText),
    ariaSnapshot: redact(rawAriaSnapshot),
    capturedAt: now().toISOString(),
  }, secretVisible: containsExactSecret(`${rawTitle}\n${rawVisibleText}\n${rawAriaSnapshot}`, secretValues) };
}

function attachTelemetry(page: Page, events: BrowserEvent[], stepId: () => string, now: () => Date, redact: (value: string) => string): void {
  page.on("console", (message) => events.push({ type: "CONSOLE", stepId: stepId(), occurredAt: now().toISOString(), payload: { level: message.type(), text: redact(message.text()).slice(0, 10_000), pageUrl: redact(page.url()) } }));
  page.on("pageerror", (error) => events.push({ type: "PAGEERROR", stepId: stepId(), occurredAt: now().toISOString(), payload: { message: redact(error.message).slice(0, 10_000), pageUrl: redact(page.url()) } }));
  page.on("request", (request) => events.push({ type: "REQUEST", stepId: stepId(), occurredAt: now().toISOString(), payload: { method: request.method(), resourceType: request.resourceType(), url: redact(request.url()) } }));
  page.on("response", (response) => events.push({ type: "RESPONSE", stepId: stepId(), occurredAt: now().toISOString(), payload: { status: response.status(), url: redact(response.url()) } }));
  page.on("requestfailed", (request) => events.push({ type: "REQUESTFAILED", stepId: stepId(), occurredAt: now().toISOString(), payload: { method: request.method(), url: redact(request.url()), failure: redact(request.failure()?.errorText ?? "unknown") } }));
}

function persistedAction(action: BrowserAction): BrowserAction {
  return action.type === "fill" && action.secret ? { ...action, value: "[REDACTED]" } : structuredClone(action);
}

function normalizeError(error: unknown, redact: (value: string) => string): StepError {
  if (error instanceof EvidencePolicyError) return { code: "EVIDENCE_FAILED", message: error.message };
  if (error instanceof errors.TimeoutError) return { code: "TIMEOUT", message: errorMessage(error, redact) };
  if (error instanceof PolicyViolationError) return { code: "POLICY_VIOLATION", message: error.message };
  return { code: "ACTION_FAILED", message: errorMessage(error, redact) };
}

function errorMessage(error: unknown, redact: (value: string) => string): string {
  return redact(error instanceof Error ? error.message : String(error)).slice(0, 5_000);
}

async function pageContainsSecret(page: Page, secretValues: string[]): Promise<boolean> {
  if (secretValues.length === 0) return false;
  const body = page.locator("body");
  const evidence = `${await page.title()}\n${(await body.innerText()).slice(0, 50_000)}\n${(await body.ariaSnapshot()).slice(0, 50_000)}`;
  return containsExactSecret(evidence, secretValues);
}

function safeName(value: string): string {
  const safe = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!safe) throw new Error("Artifact name must contain a safe character");
  return safe.slice(0, 100);
}

function validateSpec(spec: FixedTestSpec): void {
  if (!spec.runId.trim() || !spec.name.trim()) throw new Error("Run ID and name are required");
  if (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs <= 0) throw new Error("timeoutMs must be a positive integer");
  if (spec.steps.length === 0) throw new Error("At least one step is required");
  const ids = new Set<string>();
  for (const step of spec.steps) {
    if (!step.id.trim() || ids.has(step.id)) throw new Error(`Step IDs must be non-empty and unique: ${step.id}`);
    ids.add(step.id);
  }
}
