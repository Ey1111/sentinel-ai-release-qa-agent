import { createHash } from "node:crypto";
import type { Evidence } from "@sentinel/contracts";
import { chromium, errors, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { ArtifactStore } from "./artifact-store";
import { DomainPolicy, PolicyViolationError } from "./policy";
import { redactSecrets } from "./redaction";

export type InteractiveAction =
  | { type: "NAVIGATE"; url: string }
  | { type: "CLICK"; elementRef: string }
  | { type: "FILL"; elementRef: string; value: string | { secretRef: string } }
  | { type: "SCREENSHOT"; reason: string };

export type InteractiveObservation = {
  schemaVersion: "1";
  id: string;
  runId: string;
  stepId: string;
  pageEpoch: string;
  url: string;
  title: string;
  visibleText: string;
  ariaSnapshot: string;
  interactiveElements: Array<{ ref: string; role: string; name: string; hasValue?: boolean }>;
  consoleErrors: Array<Record<string, unknown>>;
  networkFailures: Array<Record<string, unknown>>;
  browserErrors: Array<Record<string, unknown>>;
  screenshotId?: string;
  capturedAt: string;
  contentHash: string;
};

export type InteractiveObservationCapture = {
  observation: InteractiveObservation;
  evidence: Evidence[];
  observationHealthy: boolean;
  hardFailureEvidenceIds: string[];
  failureSignals?: { coreNetworkFailure?: boolean };
};

type InteractiveConsoleError = {
  kind: "CONSOLE_ERROR";
  level: "error";
  text: string;
  pageUrl: string;
  occurredAt: string;
};

type InteractiveNetworkFailure =
  | { kind: "HTTP_ERROR"; status: number; method: string; url: string; isCore: boolean; occurredAt: string }
  | { kind: "REQUEST_FAILED"; method: string; url: string; failure: string; isCore: boolean; occurredAt: string };

type InteractiveBrowserError = {
  kind: "PAGE_ERROR";
  message: string;
  pageUrl: string;
  occurredAt: string;
};

type StepEvent<T> = T & { stepId: string };

export type InteractiveReceipt = {
  runId: string;
  stepId: string;
  action: InteractiveAction;
  pageUrl: string;
  occurredAt: string;
  evidence: Evidence[];
  evidenceKeys?: string[];
};

export class InteractiveActionError extends Error {
  override readonly name = "InteractiveActionError";

  constructor(
    message: string,
    readonly code: "TIMEOUT" | "POLICY_VIOLATION" | "ACTION_FAILED" | "EVIDENCE_FAILED",
    readonly runId: string,
    readonly stepId: string,
    readonly evidence: Evidence[],
  ) {
    super(message);
  }
}

export class InteractiveSessionBusyError extends Error {
  override readonly name = "InteractiveSessionBusyError";
  readonly code = "SESSION_BUSY";

  constructor(readonly runId: string) {
    super("Interactive browser session already has an operation in progress.");
  }
}

type SessionOptions = {
  runId: string;
  artifactRoot: string;
  allowedOrigins: string[];
  allowLocalhost?: boolean;
  timeoutMs: number;
  headless?: boolean;
  resolveSecret?: (secretRef: string) => Promise<string>;
  now?: () => Date;
};

export class InteractiveBrowserSession {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private readonly policy: DomainPolicy;
  private readonly artifacts: ArtifactStore;
  private readonly refs = new Map<string, Locator>();
  private readonly secretValues = new Set<string>();
  private readonly consoleErrors: Array<StepEvent<InteractiveConsoleError>> = [];
  private readonly networkFailures: Array<StepEvent<InteractiveNetworkFailure>> = [];
  private readonly browserErrors: Array<StepEvent<InteractiveBrowserError>> = [];
  private activeStepId: string | undefined;
  private busy = false;
  private actionSequence = 0;
  private observationSequence = 0;
  private pageEpoch = 0;
  private lastUrl = "about:blank";

  constructor(private readonly options: SessionOptions) {
    this.policy = new DomainPolicy({ allowedOrigins: options.allowedOrigins, ...(options.allowLocalhost === undefined ? {} : { allowLocalhost: options.allowLocalhost }) });
    this.artifacts = new ArtifactStore({ rootDir: options.artifactRoot, runId: options.runId, ...(options.now ? { now: options.now } : {}) });
  }

  async open(): Promise<void> {
    if (this.browser) throw new Error("Interactive browser session is already open");
    await this.artifacts.initialize();
    this.browser = await chromium.launch({ headless: this.options.headless ?? true });
    this.context = await this.browser.newContext({ acceptDownloads: false, serviceWorkers: "block" });
    await this.context.route("**/*", async (route) => {
      try {
        this.policy.assertAllowed(route.request().url());
        await route.continue();
      } catch (error) {
        await route.abort("blockedbyclient");
        if (!(error instanceof PolicyViolationError)) throw error;
      }
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.options.timeoutMs);
    this.page.setDefaultNavigationTimeout(this.options.timeoutMs);
    this.page.on("console", (message) => {
      if (message.type() !== "error" || !this.activeStepId) return;
      this.consoleErrors.push({
        stepId: this.activeStepId,
        kind: "CONSOLE_ERROR",
        level: "error",
        text: this.redact(message.text()).slice(0, 10_000),
        pageUrl: this.redact(this.page?.url() ?? "about:blank"),
        occurredAt: this.now().toISOString(),
      });
    });
    this.page.on("pageerror", (error) => {
      if (!this.activeStepId) return;
      this.browserErrors.push({
        stepId: this.activeStepId,
        kind: "PAGE_ERROR",
        message: this.redact(error.message).slice(0, 10_000),
        pageUrl: this.redact(this.page?.url() ?? "about:blank"),
        occurredAt: this.now().toISOString(),
      });
    });
    this.page.on("response", (response) => {
      if (!this.activeStepId || response.status() < 400) return;
      this.networkFailures.push({
        stepId: this.activeStepId,
        kind: "HTTP_ERROR",
        status: response.status(),
        method: response.request().method(),
        url: this.redact(response.url()).slice(0, 10_000),
        isCore: this.isCoreUrl(response.url()),
        occurredAt: this.now().toISOString(),
      });
    });
    this.page.on("requestfailed", (request) => {
      if (!this.activeStepId) return;
      this.networkFailures.push({
        stepId: this.activeStepId,
        kind: "REQUEST_FAILED",
        method: request.method(),
        url: this.redact(request.url()).slice(0, 10_000),
        failure: this.redact(request.failure()?.errorText ?? "unknown").slice(0, 2_000),
        isCore: this.isCoreUrl(request.url()),
        occurredAt: this.now().toISOString(),
      });
    });
  }

  async observe(input: { stepId: string; captureScreenshot?: boolean }): Promise<InteractiveObservationCapture> {
    return this.runExclusive(() => this.observeUnlocked(input));
  }

  private async observeUnlocked(input: { stepId: string; captureScreenshot?: boolean }): Promise<InteractiveObservationCapture> {
    if (!input.stepId.trim()) throw new Error("stepId is required for observation capture");
    this.activeStepId = input.stepId;
    const page = this.requirePage();
    this.assertCurrentPageAllowed();
    this.refreshPageEpoch();
    this.observationSequence += 1;
    this.refs.clear();
    const candidates = page.locator("button, a[href], input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=textbox]");
    const interactiveElements: InteractiveObservation["interactiveElements"] = [];
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const locator = candidates.nth(index);
      if (!await locator.isVisible()) continue;
      const details = await locator.evaluate((element) => {
        const html = element as HTMLElement;
        const input = element as HTMLInputElement;
        const explicitRole = html.getAttribute("role");
        const tag = html.tagName.toLowerCase();
        const role = explicitRole ?? (tag === "button" ? "button" : tag === "a" ? "link" : tag === "select" ? "combobox" : "textbox");
        const label = input.labels?.[0]?.textContent?.trim();
        const name = html.getAttribute("aria-label")?.trim() || label || html.textContent?.trim() || input.placeholder?.trim() || input.name || role;
        const isField = tag === "input" || tag === "textarea";
        return { role, name: name.slice(0, 300), ...(isField ? { hasValue: input.value.length > 0 } : {}) };
      });
      const ref = `p${this.pageEpoch}-o${this.observationSequence}-e${interactiveElements.length + 1}`;
      this.refs.set(ref, locator);
      interactiveElements.push({ ref, role: details.role, name: this.redact(details.name), ...(details.hasValue === undefined ? {} : { hasValue: details.hasValue }) });
    }
    const body = page.locator("body");
    const capturedAt = this.now().toISOString();
    const pageEpoch = `p${this.pageEpoch}-o${this.observationSequence}`;
    const observationId = stableId("observation", this.options.runId, input.stepId, String(this.observationSequence));
    const consoleErrors = takeStepEvents(this.consoleErrors, input.stepId);
    const networkFailures = takeStepEvents(this.networkFailures, input.stepId);
    const browserErrors = takeStepEvents(this.browserErrors, input.stepId);
    const rawTitle = (await page.title()).slice(0, 1_000);
    const rawVisibleText = (await body.innerText()).slice(0, 50_000);
    const rawAriaSnapshot = (await body.ariaSnapshot()).slice(0, 50_000);
    const rawEditableValues = await page.locator("input, textarea, select").evaluateAll((elements) => elements
      .map((element) => (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value)
      .join("\n"));
    const state = {
      url: this.redact(page.url()),
      title: this.redact(rawTitle),
      visibleText: this.redact(rawVisibleText),
      ariaSnapshot: this.redact(rawAriaSnapshot),
      interactiveElements,
      consoleErrors,
      networkFailures,
      browserErrors,
    };
    const captureName = `${String(this.observationSequence).padStart(4, "0")}-${safeName(input.stepId)}`;
    const evidence: Evidence[] = [];
    let screenshotId: string | undefined;
    const rawScreenshotState = `${page.url()}\n${rawTitle}\n${rawVisibleText}\n${rawAriaSnapshot}\n${rawEditableValues}`;
    if (input.captureScreenshot) {
      const screenshotEvidence = await this.captureScreenshotEvidence(page, input.stepId, captureName, pageEpoch, capturedAt, rawScreenshotState);
      evidence.push(screenshotEvidence);
      if (screenshotEvidence.type === "SCREENSHOT") screenshotId = screenshotEvidence.id;
    }
    const observation: InteractiveObservation = {
      schemaVersion: "1",
      id: observationId,
      runId: this.options.runId,
      stepId: input.stepId,
      pageEpoch,
      ...state,
      ...(screenshotId ? { screenshotId } : {}),
      capturedAt,
      contentHash: sha256(JSON.stringify(state)),
    };
    const observationEntry = await this.artifacts.writeJson(`observations/${captureName}.json`, observation, { stepId: input.stepId, redacted: true });
    evidence.unshift(
      {
        schemaVersion: "1",
        id: stableId("evidence", this.options.runId, input.stepId, pageEpoch, "DOM_STATE"),
        runId: this.options.runId,
        stepId: input.stepId,
        type: "DOM_STATE",
        content: observation.ariaSnapshot || "[empty]",
        artifactPath: observationEntry.key,
        sha256: observationEntry.sha256,
        createdAt: capturedAt,
        redactionStatus: "REDACTED",
      },
      {
        schemaVersion: "1",
        id: stableId("evidence", this.options.runId, input.stepId, pageEpoch, "VISIBLE_TEXT"),
        runId: this.options.runId,
        stepId: input.stepId,
        type: "VISIBLE_TEXT",
        content: observation.visibleText || "[empty]",
        artifactPath: observationEntry.key,
        sha256: observationEntry.sha256,
        createdAt: capturedAt,
        redactionStatus: "REDACTED",
      },
    );
    if (consoleErrors.length > 0) {
      const entry = await this.artifacts.writeJson(`console/${captureName}.json`, consoleErrors, { stepId: input.stepId, redacted: true });
      evidence.push(evidenceForArtifact(this.options.runId, input.stepId, pageEpoch, "CONSOLE_ERROR", consoleErrors, entry, capturedAt));
    }
    if (networkFailures.length > 0) {
      const entry = await this.artifacts.writeJson(`network/${captureName}.json`, networkFailures, { stepId: input.stepId, redacted: true });
      evidence.push(evidenceForArtifact(this.options.runId, input.stepId, pageEpoch, "NETWORK_FAILURE", networkFailures, entry, capturedAt));
    }
    if (browserErrors.length > 0) {
      const entry = await this.artifacts.writeJson(`traces/${captureName}-browser-errors.json`, browserErrors, { stepId: input.stepId, redacted: true });
      evidence.push(evidenceForArtifact(this.options.runId, input.stepId, pageEpoch, "PLAYWRIGHT_ERROR", browserErrors, entry, capturedAt));
    }
    const coreNetworkFailure = networkFailures.some((failure) => failure.isCore);
    const hardFailureEvidenceIds = evidence
      .filter((item) => item.type === "PLAYWRIGHT_ERROR" || (item.type === "NETWORK_FAILURE" && coreNetworkFailure))
      .map((item) => item.id);
    return {
      observation,
      evidence,
      observationHealthy: true,
      hardFailureEvidenceIds,
      ...(coreNetworkFailure ? { failureSignals: { coreNetworkFailure: true } } : {}),
    };
  }

  async execute(input: { stepId: string; action: InteractiveAction }): Promise<InteractiveReceipt> {
    return this.runExclusive(() => this.executeUnlocked(input));
  }

  private async executeUnlocked(input: { stepId: string; action: InteractiveAction }): Promise<InteractiveReceipt> {
    if (!input.stepId.trim()) throw new Error("stepId is required for browser execution");
    this.activeStepId = input.stepId;
    this.actionSequence += 1;
    const action = input.action;
    const page = this.requirePage();
    const evidence: Evidence[] = [];
    const evidenceKeys: string[] = [];
    try {
      if (action.type === "NAVIGATE") {
        this.policy.assertAllowed(action.url);
        await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: this.options.timeoutMs });
        this.refs.clear();
        this.refreshPageEpoch();
      } else if (action.type === "CLICK") {
        await this.currentLocator(action.elementRef).click({ timeout: this.options.timeoutMs });
      } else if (action.type === "FILL") {
        const value = typeof action.value === "string" ? action.value : await this.resolveSecret(action.value.secretRef);
        await this.currentLocator(action.elementRef).fill(value, { timeout: this.options.timeoutMs });
      } else {
        const captureName = `${String(this.actionSequence).padStart(4, "0")}-${safeName(input.stepId)}`;
        const screenshotEvidence = await this.captureScreenshotEvidence(
          page,
          input.stepId,
          captureName,
          `a${this.actionSequence}`,
          this.now().toISOString(),
        );
        evidence.push(screenshotEvidence);
        if (screenshotEvidence.artifactPath) evidenceKeys.push(screenshotEvidence.artifactPath);
      }
      this.assertCurrentPageAllowed();
    } catch (error) {
      const normalized = this.normalizeActionError(error, action.type);
      const occurredAt = this.now().toISOString();
      const captureName = `${String(this.actionSequence).padStart(4, "0")}-${safeName(input.stepId)}-playwright-error`;
      const payload = { ...normalized, operation: action.type, pageUrl: this.redact(page.url()), occurredAt };
      const entry = await this.artifacts.writeJson(`traces/${captureName}.json`, payload, { stepId: input.stepId, redacted: true });
      const evidence: Evidence[] = [{
        schemaVersion: "1",
        id: stableId("evidence", this.options.runId, input.stepId, String(this.actionSequence), "PLAYWRIGHT_ERROR"),
        runId: this.options.runId,
        stepId: input.stepId,
        type: "PLAYWRIGHT_ERROR",
        content: JSON.stringify(payload),
        artifactPath: entry.key,
        sha256: entry.sha256,
        createdAt: occurredAt,
        redactionStatus: "REDACTED",
      }];
      throw new InteractiveActionError(normalized.message, normalized.code, this.options.runId, input.stepId, evidence);
    }
    return {
      runId: this.options.runId,
      stepId: input.stepId,
      action: persistedAction(action, (value) => this.redact(value)),
      pageUrl: this.redact(page.url()),
      occurredAt: this.now().toISOString(),
      evidence,
      ...(evidenceKeys.length ? { evidenceKeys } : {}),
    };
  }

  async close(): Promise<void> {
    this.refs.clear();
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;
  }

  private currentLocator(ref: string): Locator {
    const locator = this.refs.get(ref);
    if (!locator) throw new Error("Element ref does not belong to the current observation");
    return locator;
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new InteractiveSessionBusyError(this.options.runId);
    this.busy = true;
    try {
      return await operation();
    } finally {
      this.busy = false;
    }
  }

  private async resolveSecret(secretRef: string): Promise<string> {
    if (!this.options.resolveSecret) throw new Error("A secret resolver is required for secretRef values");
    const value = await this.options.resolveSecret(secretRef);
    this.secretValues.add(value);
    return value;
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  private redact(value: string): string {
    return redactSecrets(value, [...this.secretValues]);
  }

  private isCoreUrl(value: string): boolean {
    try {
      return this.options.allowedOrigins.includes(new URL(value).origin);
    } catch {
      return false;
    }
  }

  private async captureScreenshotEvidence(
    page: Page,
    stepId: string,
    captureName: string,
    identity: string,
    createdAt: string,
    rawState?: string,
  ): Promise<Evidence> {
    const suppressionReason = await this.screenshotSuppressionReason(page, rawState);
    if (suppressionReason) {
      const suppression = { reason: suppressionReason, screenshotCaptured: false };
      const entry = await this.artifacts.writeJson(`evidence/${captureName}-screenshot-suppressed.json`, suppression, { stepId, redacted: true });
      return {
        schemaVersion: "1",
        id: stableId("evidence", this.options.runId, stepId, identity, "TRACE", suppressionReason),
        runId: this.options.runId,
        stepId,
        type: "TRACE",
        content: suppressionReason,
        artifactPath: entry.key,
        sha256: entry.sha256,
        createdAt,
        redactionStatus: "REDACTED",
      };
    }
    const screenshot = await page.screenshot({ fullPage: true, type: "png" });
    const entry = await this.artifacts.write(`screenshots/${captureName}.png`, screenshot, "image/png", { stepId, redacted: false });
    return {
      schemaVersion: "1",
      id: stableId("evidence", this.options.runId, stepId, identity, "SCREENSHOT"),
      runId: this.options.runId,
      stepId,
      type: "SCREENSHOT",
      artifactPath: entry.key,
      sha256: entry.sha256,
      createdAt,
      redactionStatus: "NOT_REQUIRED",
    };
  }

  private async screenshotSuppressionReason(page: Page, rawState?: string): Promise<string | undefined> {
    const inspectedState = rawState ?? await this.readScreenshotState(page);
    if (this.redact(inspectedState) !== inspectedState) return "SCREENSHOT_SUPPRESSED_SECRET_VISIBLE";
    if (await page.locator("canvas, video").count() > 0) return "SCREENSHOT_SUPPRESSED_UNINSPECTABLE_MEDIA";
    return undefined;
  }

  private async readScreenshotState(page: Page): Promise<string> {
    const body = page.locator("body");
    const editableValues = await page.locator("input, textarea, select").evaluateAll((elements) => elements
      .map((element) => (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value)
      .join("\n"));
    return `${page.url()}\n${await page.title()}\n${await body.innerText()}\n${await body.ariaSnapshot()}\n${editableValues}`;
  }

  private normalizeActionError(error: unknown, operation: InteractiveAction["type"]): {
    code: InteractiveActionError["code"];
    message: string;
  } {
    if (error instanceof errors.TimeoutError) {
      return { code: "TIMEOUT", message: `Browser ${operation} timed out after ${this.options.timeoutMs} ms.` };
    }
    if (error instanceof PolicyViolationError) {
      return { code: "POLICY_VIOLATION", message: this.redact(error.message).slice(0, 2_000) };
    }
    return { code: operation === "SCREENSHOT" ? "EVIDENCE_FAILED" : "ACTION_FAILED", message: `Browser ${operation} failed.` };
  }

  private requirePage(): Page {
    if (!this.page) throw new Error("Interactive browser session is not open");
    return this.page;
  }

  private refreshPageEpoch(): void {
    const url = this.requirePage().url();
    if (url !== this.lastUrl) {
      this.pageEpoch += 1;
      this.lastUrl = url;
    }
  }

  private assertCurrentPageAllowed(): void {
    const url = this.requirePage().url();
    if (url !== "about:blank") this.policy.assertAllowed(url);
  }
}

function persistedAction(action: InteractiveAction, redact: (value: string) => string): InteractiveAction {
  if (action.type === "FILL") {
    return typeof action.value === "string"
      ? { ...action, value: redact(action.value) }
      : { ...action, value: { ...action.value } };
  }
  if (action.type === "NAVIGATE") return { ...action, url: redact(action.url) };
  if (action.type === "SCREENSHOT") return { ...action, reason: redact(action.reason) };
  return { ...action };
}

function safeName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (normalized || "capture").slice(0, 80);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${sha256(JSON.stringify(parts)).slice(0, 24)}`;
}

function takeStepEvents<T extends { stepId: string }>(events: T[], stepId: string): Array<Omit<T, "stepId">> {
  const captured: Array<Omit<T, "stepId">> = [];
  const retained: T[] = [];
  for (const event of events) {
    if (event.stepId !== stepId) {
      retained.push(event);
      continue;
    }
    const value: Partial<T> = { ...event };
    delete value.stepId;
    captured.push(value as Omit<T, "stepId">);
  }
  events.splice(0, events.length, ...retained);
  return captured;
}

function evidenceForArtifact(
  runId: string,
  stepId: string,
  pageEpoch: string,
  type: "CONSOLE_ERROR" | "NETWORK_FAILURE" | "PLAYWRIGHT_ERROR",
  content: unknown,
  artifact: { key: string; sha256: string },
  createdAt: string,
): Evidence {
  return {
    schemaVersion: "1",
    id: stableId("evidence", runId, stepId, pageEpoch, type),
    runId,
    stepId,
    type,
    content: JSON.stringify(content),
    artifactPath: artifact.key,
    sha256: artifact.sha256,
    createdAt,
    redactionStatus: "REDACTED",
  };
}
