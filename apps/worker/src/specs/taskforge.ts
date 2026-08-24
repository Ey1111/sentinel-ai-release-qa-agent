import type { FixedTestSpec } from "@sentinel/browser-runtime";

type TaskForgeSpecOptions = {
  runId: string;
  targetUrl: string;
  email?: string;
  password?: string;
};

export function createTaskForgeFixedSpec(options: TaskForgeSpecOptions): FixedTestSpec {
  const target = new URL(options.targetUrl);
  target.searchParams.set("breakMode", "none");
  const local = target.hostname === "localhost" || target.hostname === "127.0.0.1" || target.hostname === "[::1]";
  return {
    runId: options.runId,
    name: "TaskForge deterministic business flow",
    allowedOrigins: [target.origin],
    allowLocalhost: local,
    timeoutMs: 5_000,
    steps: [
      { id: "navigate", action: { type: "navigate", url: target.toString() } },
      { id: "fill-email", action: { type: "fill", target: { by: "label", value: "Email" }, value: options.email ?? "qa@taskforge.local" } },
      { id: "fill-password", action: { type: "fill", target: { by: "label", value: "Password" }, value: options.password ?? "sentinel-demo", secret: true } },
      { id: "login", action: { type: "click", target: { by: "role", role: "button", name: "Log in" } } },
      { id: "open-create-project", action: { type: "click", target: { by: "role", role: "button", name: "New project" } } },
      { id: "fill-project-name", action: { type: "fill", target: { by: "label", value: "Project name" }, value: "Sentinel Release" } },
      { id: "create-project", action: { type: "click", target: { by: "role", role: "button", name: "Create project" } } },
      { id: "open-rename-project", action: { type: "click", target: { by: "role", role: "button", name: "Rename Sentinel Release" } } },
      { id: "fill-renamed-project", action: { type: "fill", target: { by: "label", value: "New project name" }, value: "Sentinel Release Gate" } },
      { id: "save-renamed-project", action: { type: "click", target: { by: "role", role: "button", name: "Save name" } } },
      { id: "verify-renamed-project", action: { type: "snapshot" } },
      { id: "capture-complete", action: { type: "screenshot", name: "taskforge-complete" } },
      { id: "logout", action: { type: "click", target: { by: "role", role: "button", name: "Log out" } } },
    ],
  };
}
