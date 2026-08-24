export type BrowserTarget =
  | { by: "label"; value: string }
  | { by: "role"; role: "button" | "link" | "heading" | "textbox"; name: string }
  | { by: "text"; value: string };

export type BrowserAction =
  | { type: "navigate"; url: string }
  | { type: "click"; target: BrowserTarget }
  | { type: "fill"; target: BrowserTarget; value: string; secret?: boolean }
  | { type: "snapshot" }
  | { type: "screenshot"; name: string };

export type FixedTestStep = { id: string; action: BrowserAction };

export type FixedTestSpec = {
  runId: string;
  name: string;
  allowedOrigins: string[];
  allowLocalhost?: boolean;
  timeoutMs: number;
  steps: FixedTestStep[];
};

export type Observation = {
  pageEpoch: number;
  url: string;
  title: string;
  visibleText: string;
  ariaSnapshot: string;
  capturedAt: string;
};

export type BrowserEvent = {
  type: "CONSOLE" | "PAGEERROR" | "REQUEST" | "RESPONSE" | "REQUESTFAILED";
  stepId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};

export type StepError = { code: "TIMEOUT" | "POLICY_VIOLATION" | "ACTION_FAILED" | "EVIDENCE_FAILED"; message: string };

export type StepResult = {
  id: string;
  index: number;
  action: BrowserAction;
  status: "RUNNING" | "PASSED" | "FAILED" | "SKIPPED";
  startedAt?: string;
  finishedAt?: string;
  observation?: Observation;
  artifactKeys: string[];
  error?: StepError;
};

export type RunResult = {
  runId: string;
  name: string;
  status: "RUNNING" | "PASSED" | "FAILED";
  startedAt: string;
  finishedAt?: string;
  steps: StepResult[];
};

export type ArtifactManifestEntry = {
  key: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
  redacted: boolean;
  stepId?: string;
};
